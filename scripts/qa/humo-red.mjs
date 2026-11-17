// Prueba de humo de red (Sprint 4, Sebastián): recorre el flujo principal contra
// el backend desplegado (Azure) desde la red en la que estás (casa, universidad,
// datos móviles) y deja una fila para docs/qa/pruebas-de-red.md. Se repite
// después de CADA cambio de firewall, red o secretos: a veces el firewall corta
// solo algunas peticiones (por ejemplo el WebSocket) y no todas.
//
// Qué revisa, en orden y midiendo el tiempo de cada paso:
//   1. GET /v1/health responde, con su commit.
//   2. Cabeceras de seguridad (CSP, HSTS, nosniff) y HTTPS.
//   3. Una ruta privada sin sesión responde 401.
//   4. CORS: el origen de la web (WEB_ORIGIN) está permitido.
//   5. Inicio de sesión real (Firebase) del comensal y del restaurante.
//   6. Búsqueda: el restaurante de prueba aparece.
//   7. WebSocket del comensal y del restaurante conectados.
//   8. Con CONFIRM=1: reserva → llega a la web por el socket → cancelación (o
//      check-in con CHECKIN=1) → llega al comensal por el socket.
//
// Entradas (solo variables de entorno; nunca archivos ni valores por defecto de
// credenciales):
//   BASE_URL          origen del backend, sin /v1 (https://… o http://localhost:<puerto>)
//   NETWORK_LABEL     dónde estás: «casa», «universidad», «datos móviles»…
//   WEB_ORIGIN        opcional: origen de la web para revisar CORS (https://…)
//   FIREBASE_API_KEY  llave web del proyecto de Firebase (es pública)
//   DINER_EMAIL / DINER_PASSWORD   comensal de prueba
//   ADMIN_EMAIL / ADMIN_PASSWORD   restaurant_admin del restaurante de prueba
//   RESTAURANT_ID     uuid de ese restaurante (abierto y con una mesa libre)
//   Sin FIREBASE_API_KEY ni cuentas solo corren los pasos 1 a 4 (chequeo rápido,
//   sin sesión).
//   PARTY_SIZE        opcional, 1 a 20 (por defecto 2)
//   CONFIRM=1         crea UNA reserva y la cancela; sin esto no escribe nada
//   CHECKIN=1         con CONFIRM=1, hace check-in en vez de cancelar. Deja un
//                     check-in FACTURABLE y la mesa Ocupada (el script la vuelve
//                     a Disponible). Úsalo solo cuando haga falta probarlo.
//
// Nunca imprime ni guarda claves, tokens ni códigos de reserva.
//
// Ejemplo (los valores van en tu terminal, nunca en un archivo del repo):
//   BASE_URL=https://<api> NETWORK_LABEL=universidad … node scripts/qa/humo-red.mjs

import { io } from 'socket.io-client';

const FIREBASE_SIGN_IN_URL =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 20_000;
const SOCKET_EVENT_TIMEOUT_MS = 10_000;

class ConfigError extends Error {}

function fail(message) {
  throw new ConfigError(message);
}

function readRequired(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    fail(`${name} es obligatoria.`);
  }
  return value.trim();
}

function readOrigin(name, { optional = false } = {}) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return optional ? null : fail(`${name} es obligatoria.`);
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${name} no es una URL válida.`);
  }
  if (url.pathname !== '/' || url.search || url.username || url.password) {
    fail(`${name} debe ser solo el origen, sin ruta ni credenciales.`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !local) {
    fail(`${name} debe ser https (o localhost).`);
  }
  return url.origin;
}

function readConfig() {
  const withAccounts = Boolean(process.env.FIREBASE_API_KEY?.trim());
  const restaurantId = withAccounts
    ? readRequired('RESTAURANT_ID').toLowerCase()
    : null;
  if (withAccounts && !UUID_PATTERN.test(restaurantId)) {
    fail('RESTAURANT_ID debe ser un uuid.');
  }
  const rawParty = process.env.PARTY_SIZE?.trim() || '2';
  const partySize = Number(rawParty);
  if (!/^\d+$/.test(rawParty) || partySize < 1 || partySize > 20) {
    fail('PARTY_SIZE debe ser un entero entre 1 y 20.');
  }
  return {
    origin: readOrigin('BASE_URL'),
    webOrigin: readOrigin('WEB_ORIGIN', { optional: true }),
    network: readRequired('NETWORK_LABEL'),
    withAccounts,
    apiKey: withAccounts ? readRequired('FIREBASE_API_KEY') : null,
    diner: withAccounts
      ? [readRequired('DINER_EMAIL'), readRequired('DINER_PASSWORD')]
      : null,
    admin: withAccounts
      ? [readRequired('ADMIN_EMAIL'), readRequired('ADMIN_PASSWORD')]
      : null,
    restaurantId,
    partySize,
    confirm: process.env.CONFIRM === '1',
    checkIn: process.env.CHECKIN === '1',
  };
}

// Sin el mensaje completo de fetch: nunca incluye cabeceras ni la URL con la llave.
function networkError(error) {
  if (error?.name === 'TimeoutError') {
    return 'tiempo de espera agotado';
  }
  return `error de red (${error?.cause?.code ?? error?.name ?? 'desconocido'})`;
}

async function signIn(apiKey, [email, password]) {
  try {
    const response = await fetch(
      `${FIREBASE_SIGN_IN_URL}?${new URLSearchParams({ key: apiKey })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const json = await response.json().catch(() => null);
    if (response.ok && typeof json?.idToken === 'string') {
      return { token: json.idToken };
    }
    const message = json?.error?.message;
    return {
      error: typeof message === 'string' ? message.split(/[\s:]/)[0] : 'ERROR',
    };
  } catch (error) {
    return { error: networkError(error) };
  }
}

function makeApi(origin) {
  return async (method, path, { token, body, headers = {} } = {}) => {
    try {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: {
          ...headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json = await response.json().catch(() => null);
      return { status: response.status, json, headers: response.headers };
    } catch (error) {
      return { status: null, error: networkError(error) };
    }
  };
}

function describe(result) {
  if (result.status === null) {
    return result.error;
  }
  return `HTTP ${result.status}${result.json?.errorCode ? ` · ${result.json.errorCode}` : ''}`;
}

function connectSocket(origin, token) {
  return new Promise((resolve) => {
    const socket = io(origin, {
      reconnection: false,
      transports: ['websocket'],
      auth: (cb) => cb({ token }),
      timeout: REQUEST_TIMEOUT_MS,
    });
    socket.on('connect', () => resolve({ socket }));
    socket.on('connect_error', (error) => {
      socket.close();
      resolve({ error: error.message });
    });
  });
}

function waitFor(socket, event, matches) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve(null);
    }, SOCKET_EVENT_TIMEOUT_MS);
    function onEvent(payload) {
      if (matches(payload)) {
        clearTimeout(timer);
        socket.off(event, onEvent);
        resolve(payload);
      }
    }
    socket.on(event, onEvent);
  });
}

// Cada paso: nombre, resultado (OK/FALLA/OMITIDO), detalle sin datos sensibles, ms.
const steps = [];

async function step(name, run) {
  const started = performance.now();
  let outcome;
  try {
    outcome = await run();
  } catch (error) {
    outcome = { ok: false, detail: `excepción (${error?.name ?? 'error'})` };
  }
  const ms = Math.round(performance.now() - started);
  steps.push({ name, ...outcome, ms });
  const mark = outcome.skipped ? '—' : outcome.ok ? 'OK' : 'FALLA';
  console.log(
    `${mark.padEnd(5)} ${name} (${ms} ms)${outcome.detail ? ` · ${outcome.detail}` : ''}`,
  );
  return outcome;
}

async function main() {
  const config = readConfig();
  const api = makeApi(config.origin);
  const tokens = {};
  const sockets = {};
  console.log(`Prueba de humo de red · ${config.network} · ${config.origin}\n`);

  await step('Salud (GET /v1/health)', async () => {
    const result = await api('GET', '/v1/health');
    return {
      ok: result.status === 200,
      detail:
        result.status === 200
          ? `commit ${String(result.json?.commit ?? 'null').slice(0, 7)}`
          : describe(result),
      headers: result.headers,
    };
  });

  await step('Cabeceras de seguridad y HTTPS', async () => {
    const headers = steps[0].headers;
    if (!headers) {
      return { ok: false, detail: 'sin respuesta de /v1/health' };
    }
    const missing = [
      'content-security-policy',
      'strict-transport-security',
      'x-content-type-options',
    ].filter((name) => !headers.get(name));
    const https = config.origin.startsWith('https://');
    return {
      ok:
        missing.length === 0 && (https || config.origin.includes('localhost')),
      detail: [
        missing.length ? `faltan: ${missing.join(', ')}` : '',
        https ? '' : 'sin HTTPS (solo vale en local)',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  });

  await step('Ruta privada sin sesión → 401', async () => {
    const result = await api('GET', '/v1/me');
    return { ok: result.status === 401, detail: describe(result) };
  });

  await step('CORS de la web', async () => {
    if (!config.webOrigin) {
      return { skipped: true, detail: 'sin WEB_ORIGIN' };
    }
    const result = await api('OPTIONS', '/v1/me', {
      headers: {
        origin: config.webOrigin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    const allowed = result.headers?.get('access-control-allow-origin');
    return {
      ok: allowed === config.webOrigin,
      detail:
        allowed === config.webOrigin
          ? ''
          : `no permitido (${describe(result)})`,
    };
  });

  if (!config.withAccounts) {
    await step('Sesión, búsqueda, WebSocket y reserva', async () => ({
      skipped: true,
      detail: 'sin FIREBASE_API_KEY ni cuentas',
    }));
    printSummary(config);
    process.exitCode = steps.some((item) => item.ok === false) ? 1 : 0;
    return;
  }

  for (const [key, label, credentials] of [
    ['diner', 'comensal', config.diner],
    ['admin', 'restaurante', config.admin],
  ]) {
    await step(`Inicio de sesión del ${label}`, async () => {
      const result = await signIn(config.apiKey, credentials);
      if (result.error) {
        return { ok: false, detail: result.error };
      }
      tokens[key] = result.token;
      const me = await api('GET', '/v1/me', { token: result.token });
      const expected = key === 'diner' ? 'diner' : 'restaurant_admin';
      return {
        ok: me.status === 200 && me.json?.role === expected,
        detail: me.status === 200 ? `rol ${me.json?.role}` : describe(me),
      };
    });
  }

  await step('Búsqueda: el restaurante de prueba aparece', async () => {
    if (!tokens.diner) {
      return { ok: false, detail: 'sin sesión del comensal' };
    }
    const result = await api('GET', '/v1/search/restaurants', {
      token: tokens.diner,
    });
    const found =
      Array.isArray(result.json) &&
      result.json.some((item) => item.id === config.restaurantId);
    return {
      ok: result.status === 200 && found,
      detail:
        result.status === 200
          ? `${result.json.length} restaurantes${found ? '' : ' · el de prueba no está (¿cerrado o sin mesas?)'}`
          : describe(result),
    };
  });

  for (const [key, label] of [
    ['diner', 'comensal'],
    ['admin', 'restaurante'],
  ]) {
    await step(`WebSocket del ${label}`, async () => {
      if (!tokens[key]) {
        return { ok: false, detail: 'sin sesión' };
      }
      const result = await connectSocket(config.origin, tokens[key]);
      if (result.error) {
        return { ok: false, detail: `connect_error ${result.error}` };
      }
      sockets[key] = result.socket;
      return {
        ok: true,
        detail: `transporte ${result.socket.io.engine.transport.name}`,
      };
    });
  }

  if (!config.confirm) {
    await step('Reserva de punta a punta', async () => ({
      skipped: true,
      detail: 'sin CONFIRM=1',
    }));
  } else {
    await reservationRoundTrip(config, api, tokens, sockets);
  }

  Object.values(sockets).forEach((socket) => socket.close());
  printSummary(config);
  process.exitCode = steps.some((item) => item.ok === false) ? 1 : 0;
}

async function reservationRoundTrip(config, api, tokens, sockets) {
  if (!tokens.diner || !tokens.admin || !sockets.diner || !sockets.admin) {
    await step('Reserva de punta a punta', async () => ({
      ok: false,
      detail: 'faltan sesiones o sockets',
    }));
    return;
  }
  const active = await api('GET', '/v1/reservations/active', {
    token: tokens.diner,
  });
  if (active.json?.reservation) {
    await step('Reserva de punta a punta', async () => ({
      ok: false,
      detail: 'el comensal ya tiene una reserva activa: cancélala primero',
    }));
    return;
  }

  let reservation = null;
  let tableId = null;
  await step('Reservar y verla en la web por el socket', async () => {
    const created = waitFor(sockets.admin, 'reservation.created', () => true);
    const result = await api('POST', '/v1/reservations', {
      token: tokens.diner,
      body: { restaurantId: config.restaurantId, partySize: config.partySize },
    });
    if (result.status !== 201) {
      return { ok: false, detail: describe(result) };
    }
    reservation = result.json;
    const event = await created;
    tableId = event?.tableId ?? null;
    return {
      ok: event?.id === reservation.id,
      detail: event ? '' : 'la web no recibió reservation.created',
    };
  });
  if (!reservation) {
    return;
  }

  if (config.checkIn) {
    await step('Check-in y verlo en la app por el socket', async () => {
      const closed = waitFor(
        sockets.diner,
        'reservation.checked_in',
        (payload) => payload?.reservationId === reservation.id,
      );
      const result = await api('POST', '/v1/restaurants/me/check-ins', {
        token: tokens.admin,
        body: { code: reservation.code },
      });
      const event = await closed;
      return {
        ok: result.status === 200 && Boolean(event),
        detail:
          result.status === 200
            ? event
              ? ''
              : 'la app no recibió reservation.checked_in'
            : describe(result),
      };
    });
    await step('Devolver la mesa a Disponible', async () => {
      if (!tableId) {
        return { ok: false, detail: 'sin tableId: libérala a mano en la web' };
      }
      const result = await api('PATCH', `/v1/tables/${tableId}/status`, {
        token: tokens.admin,
        body: { status: 'available' },
      });
      return { ok: result.status === 200, detail: describe(result) };
    });
    return;
  }

  await step('Cancelar y verlo en la web por el socket', async () => {
    const closed = waitFor(
      sockets.admin,
      'reservation.cancelled',
      (payload) => payload?.reservationId === reservation.id,
    );
    const result = await api(
      'POST',
      `/v1/reservations/${reservation.id}/cancel`,
      { token: tokens.diner },
    );
    const event = await closed;
    return {
      ok: result.status === 200 && Boolean(event),
      detail:
        result.status === 200
          ? event
            ? ''
            : 'la web no recibió reservation.cancelled'
          : describe(result),
    };
  });
}

function printSummary(config) {
  const failed = steps.filter((item) => item.ok === false);
  const total = steps.reduce((sum, item) => sum + item.ms, 0);
  const date = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
  });
  const result =
    failed.length === 0
      ? 'Pasa'
      : `Falla: ${failed.map((item) => item.name).join('; ')}`;
  console.log(
    `\n${failed.length === 0 ? 'Todo pasó.' : `${failed.length} paso(s) fallaron.`}`,
  );
  console.log('\nFila para docs/qa/pruebas-de-red.md:');
  console.log(
    `| ${date} | ${config.network} | ${config.origin} | ${!config.withAccounts ? 'rápido (sin sesión)' : config.confirm ? (config.checkIn ? 'completo + check-in' : 'completo') : 'sin escritura'} | ${result} | ${total} ms |`,
  );
}

main().catch((error) => {
  if (error instanceof ConfigError) {
    console.error(`Configuración: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  console.error(`Error inesperado (${error?.name ?? 'error'}).`);
  process.exitCode = 1;
});
