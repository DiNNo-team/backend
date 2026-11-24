// Pruebas de carga y capacidad de DiNNo (Sprint 4, Sebastián) con k6.
// Cómo correrlas y cómo leer el resultado: docs/qa/pruebas-de-carga.md.
//
// Tres escenarios a la vez, que se pueden apagar uno por uno:
//   navegar     comensales que buscan y abren el detalle de un restaurante.
//   reservar    cada cuenta de prueba reserva y cancela en ciclo (reservas
//               simultáneas: compiten por las mesas del mismo restaurante).
//   tiempo_real conexiones de Socket.IO abiertas, como teléfonos con la app.
//
// Entradas (variables de entorno con -e o en la terminal; nada en archivos):
//   BASE_URL           origen del backend, sin /v1 (https://… o http://localhost:<puerto>)
//   PROFILE            humo | carga | estres (por defecto humo)
//   SCENARIOS          opcional: lista separada por comas (por defecto los tres)
//   RESTAURANT_ID      restaurante donde se reserva (abierto, con mesas)
//   LABEL              opcional: «1-replica», «2-replicas»… para el nombre del resultado
//   Cuentas, una de dos:
//     FIREBASE_API_KEY + DINER_EMAILS (separados por comas) + DINER_PASSWORD
//       (Azure: cuentas reales de Firebase; los tokens duran 1 hora)
//     DEV_USER_IDS     (solo local, con DEV_USER_ENABLED=true en el backend)
//
// Antes de correr contra Azure: RATE_LIMIT_FACTOR=1000 en el backend (si no,
// el límite de peticiones corta la prueba) y volver a quitarlo al terminar.
// Nunca imprime tokens ni códigos de reserva.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { WebSocket } from 'k6/websockets';

const BASE_URL = requiredEnv('BASE_URL').replace(/\/+$/, '');
const PROFILE = __ENV.PROFILE || 'humo';
const LABEL = __ENV.LABEL || 'sin-etiqueta';
const WS_URL = `${BASE_URL.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;

const PROFILES = {
  // Comprueba que el script y el sistema funcionan: pocos usuarios, 1 minuto.
  humo: {
    navegar: [{ duration: '30s', target: 5 }, { duration: '30s', target: 5 }],
    tiempo_real: [{ duration: '30s', target: 10 }, { duration: '30s', target: 10 }],
    reservarMinutos: '1m',
  },
  // Lo esperado en la demo y un piloto pequeño, con margen.
  carga: {
    navegar: [
      { duration: '1m', target: 25 },
      { duration: '3m', target: 50 },
      { duration: '1m', target: 0 },
    ],
    tiempo_real: [
      { duration: '1m', target: 100 },
      { duration: '3m', target: 200 },
      { duration: '1m', target: 0 },
    ],
    reservarMinutos: '5m',
  },
  // Sube hasta que algo se degrade: para saber dónde está el límite.
  estres: {
    navegar: [
      { duration: '2m', target: 100 },
      { duration: '2m', target: 200 },
      { duration: '2m', target: 400 },
      { duration: '1m', target: 0 },
    ],
    tiempo_real: [
      { duration: '2m', target: 300 },
      { duration: '2m', target: 600 },
      { duration: '2m', target: 1000 },
      { duration: '1m', target: 0 },
    ],
    reservarMinutos: '7m',
  },
};

const profile = PROFILES[PROFILE];
if (!profile) {
  throw new Error(`PROFILE debe ser ${Object.keys(PROFILES).join(', ')}.`);
}
const enabled = new Set(
  (__ENV.SCENARIOS || 'navegar,reservar,tiempo_real').split(',').map((s) => s.trim()),
);
const accountCount = (__ENV.DEV_USER_IDS || __ENV.DINER_EMAILS || '')
  .split(',')
  .filter(Boolean).length;

const scenarios = {};
if (enabled.has('navegar')) {
  scenarios.navegar = {
    executor: 'ramping-vus',
    exec: 'browse',
    stages: profile.navegar,
    gracefulRampDown: '10s',
  };
}
if (enabled.has('reservar')) {
  // One VU per account: a diner has only one active reservation (§12.1).
  scenarios.reservar = {
    executor: 'constant-vus',
    exec: 'reserve',
    vus: Math.max(1, accountCount),
    duration: profile.reservarMinutos,
  };
}
if (enabled.has('tiempo_real')) {
  scenarios.tiempo_real = {
    executor: 'ramping-vus',
    exec: 'realtime',
    stages: profile.tiempo_real,
    gracefulRampDown: '30s',
  };
}

export const options = {
  scenarios,
  // Lo que se considera sano (docs/qa/pruebas-de-carga.md). No corta la prueba:
  // solo marca qué pasó y qué no.
  thresholds: {
    'http_req_failed{scenario:navegar}': ['rate<0.01'],
    'http_req_duration{scenario:navegar}': ['p(95)<800'],
    reservation_create_ms: ['p(95)<1500'],
    socket_connected: ['rate>0.99'],
    socket_connect_ms: ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
};

const reservationCreateMs = new Trend('reservation_create_ms', true);
const reservationsCreated = new Counter('reservations_created');
const reservationsNoTable = new Counter('reservations_no_table');
const reservationsOther = new Counter('reservations_other_errors');
const rateLimited = new Counter('rate_limited_429');
const socketConnectMs = new Trend('socket_connect_ms', true);
const socketConnected = new Rate('socket_connected');

function requiredEnv(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`${name} es obligatoria.`);
  }
  return value;
}

// Accounts: Firebase tokens (Azure) or development users (local).
export function setup() {
  const health = http.get(`${BASE_URL}/v1/health`, { timeout: '90s' });
  if (health.status !== 200) {
    throw new Error(`El backend no responde (HTTP ${health.status}). ¿Está encendido?`);
  }
  if (__ENV.DEV_USER_IDS) {
    return {
      accounts: __ENV.DEV_USER_IDS.split(',').map((id) => ({ devUserId: id.trim() })),
      commit: health.json('commit'),
    };
  }
  const apiKey = requiredEnv('FIREBASE_API_KEY');
  const password = requiredEnv('DINER_PASSWORD');
  const accounts = requiredEnv('DINER_EMAILS')
    .split(',')
    .map((email) => {
      const response = http.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
        JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
        { headers: { 'content-type': 'application/json' }, tags: { name: 'firebase' } },
      );
      if (response.status !== 200) {
        throw new Error(`No se pudo iniciar sesión con una cuenta (HTTP ${response.status}).`);
      }
      return { token: response.json('idToken') };
    });
  return { accounts, commit: health.json('commit') };
}

function accountFor(data) {
  return data.accounts[(__VU - 1) % data.accounts.length];
}

function authHeaders(account) {
  return account.token
    ? { authorization: `Bearer ${account.token}` }
    : { 'x-dev-user-id': account.devUserId };
}

function countRateLimit(response) {
  if (response.status === 429) {
    rateLimited.add(1);
  }
}

export function browse(data) {
  const headers = authHeaders(accountFor(data));
  const search = http.get(`${BASE_URL}/v1/search/restaurants`, {
    headers,
    tags: { name: 'GET /v1/search/restaurants' },
  });
  countRateLimit(search);
  const ok = check(search, { 'búsqueda 200': (r) => r.status === 200 });
  const list = ok ? search.json() : [];
  if (Array.isArray(list) && list.length > 0) {
    const pick = list[Math.floor(Math.random() * list.length)];
    const detail = http.get(`${BASE_URL}/v1/restaurants/${pick.id}/public`, {
      headers,
      tags: { name: 'GET /v1/restaurants/:id/public' },
    });
    countRateLimit(detail);
    check(detail, { 'detalle 200': (r) => r.status === 200 });
  }
  sleep(1 + Math.random() * 2);
}

export function reserve(data) {
  const restaurantId = requiredEnv('RESTAURANT_ID');
  const headers = { ...authHeaders(accountFor(data)), 'content-type': 'application/json' };

  // A reservation left active by an earlier run blocks the account: cancel it.
  const active = http.get(`${BASE_URL}/v1/reservations/active`, {
    headers,
    tags: { name: 'GET /v1/reservations/active' },
  });
  const leftover = active.status === 200 ? active.json('reservation') : null;
  if (leftover && leftover.id) {
    http.post(`${BASE_URL}/v1/reservations/${leftover.id}/cancel`, null, {
      headers,
      tags: { name: 'POST /v1/reservations/:id/cancel' },
    });
  }

  const created = http.post(
    `${BASE_URL}/v1/reservations`,
    JSON.stringify({ restaurantId, partySize: 2 }),
    { headers, tags: { name: 'POST /v1/reservations' } },
  );
  countRateLimit(created);
  if (created.status === 201) {
    reservationCreateMs.add(created.timings.duration);
    reservationsCreated.add(1);
    sleep(1);
    const cancelled = http.post(
      `${BASE_URL}/v1/reservations/${created.json('id')}/cancel`,
      null,
      { headers, tags: { name: 'POST /v1/reservations/:id/cancel' } },
    );
    countRateLimit(cancelled);
    check(cancelled, { 'cancelación 200': (r) => r.status === 200 });
  } else if (created.status === 409 && created.json('errorCode') === 'NO_TABLE_AVAILABLE') {
    // Expected when every table is taken: it is the concurrency rule working.
    reservationsNoTable.add(1);
  } else {
    reservationsOther.add(1);
  }
  sleep(0.5 + Math.random());
}

// One phone: connects, stays connected like the app (answers the pings) and
// leaves. A rejected handshake (connect_error) counts as a failed connection.
export function realtime(data) {
  const account = accountFor(data);
  const holdMs = (20 + Math.random() * 20) * 1000;
  const started = Date.now();
  let connected = false;
  const ws = new WebSocket(WS_URL);

  ws.onmessage = (event) => {
    const message = String(event.data);
    if (message.startsWith('0')) {
      ws.send(`40${JSON.stringify(account.token ? { token: account.token } : { devUserId: account.devUserId })}`);
    } else if (message.startsWith('40')) {
      connected = true;
      socketConnectMs.add(Date.now() - started);
      socketConnected.add(true);
      setTimeout(() => ws.close(), holdMs);
    } else if (message.startsWith('44')) {
      // connect_error from the server middleware (RATE_LIMITED, UNAUTHORIZED…).
      socketConnected.add(false);
      ws.close();
    } else if (message === '2') {
      ws.send('3');
    }
  };
  ws.onerror = () => {
    if (!connected) {
      socketConnected.add(false);
    }
  };
}

export function handleSummary(summary) {
  const name = `load-tests/results/${PROFILE}-${LABEL}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  return {
    stdout: textSummary(summary),
    [name]: JSON.stringify(summary, null, 2),
  };
}

// A short summary in Spanish with the numbers docs/qa/pruebas-de-carga.md asks for.
function textSummary(summary) {
  const m = summary.metrics;
  const value = (metric, stat) => (m[metric] ? m[metric].values[stat] : undefined);
  const ms = (v) => (v === undefined ? '—' : `${Math.round(v)} ms`);
  const pct = (v) => (v === undefined ? '—' : `${(v * 100).toFixed(2)} %`);
  const n = (v) => (v === undefined ? 0 : v);
  const durationS = summary.state.testRunDurationMs / 1000;
  const lines = [
    '',
    `DiNNo · prueba de carga «${PROFILE}» · ${LABEL} · ${BASE_URL}`,
    `Duración: ${durationS.toFixed(0)} s · usuarios virtuales máximos: ${n(value('vus_max', 'max'))}`,
    '',
    `Peticiones HTTP: ${n(value('http_reqs', 'count'))} (${n(value('http_reqs', 'rate')).toFixed(1)}/s) · fallidas: ${pct(value('http_req_failed', 'rate'))}`,
    `Tiempo de respuesta: mediana ${ms(value('http_req_duration', 'med'))} · p95 ${ms(value('http_req_duration', 'p(95)'))} · máximo ${ms(value('http_req_duration', 'max'))}`,
    `Reservas creadas: ${n(value('reservations_created', 'count'))} (${(n(value('reservations_created', 'count')) / durationS).toFixed(2)}/s) · p95 al crear ${ms(value('reservation_create_ms', 'p(95)'))}`,
    `Sin mesa (409, esperado con todo lleno): ${n(value('reservations_no_table', 'count'))} · otros errores al reservar: ${n(value('reservations_other_errors', 'count'))}`,
    `WebSocket: conectados ${pct(value('socket_connected', 'rate'))} · p95 al conectar ${ms(value('socket_connect_ms', 'p(95)'))}`,
    `Respuestas 429 (límite de peticiones): ${n(value('rate_limited_429', 'count'))}`,
    '',
    'Umbrales:',
    ...Object.entries(m)
      .filter(([, metric]) => metric.thresholds)
      .flatMap(([metricName, metric]) =>
        Object.entries(metric.thresholds).map(
          ([rule, result]) => `  ${result.ok ? 'OK   ' : 'FALLA'} ${metricName} ${rule}`,
        ),
      ),
    '',
  ];
  return lines.join('\n');
}
