// QA del Sprint 3, caso T1, filas de WebSocket 7 a 13 (docs/qa/sprint3-jacobo.md):
// cada cuenta recibe solo lo suyo. Contra el backend LOCAL, con cuentas reales de
// Firebase. Contratos: CLAUDE.md §10 («Tiempo real»), §12.7 y §12.8.
// Usa socket.io-client (ya está en devDependencies, igual que listen-availability.mjs).
//
// Qué hace:
//   1. Rechazos: dinnoteam2026+qaadmin@gmail.com (admin sin restaurante) → RESTAURANT_REQUIRED,
//      sin token y con token falso → UNAUTHORIZED, qa26 (sin perfil) → PROFILE_REQUIRED.
//   2. Conecta qa21, qa22 y el admin de A, e imprime cada evento que reciben.
//   3. Genera eventos por HTTP: qa21 reserva en A, el admin hace el check-in y deja
//      la mesa Disponible; qa22 reserva en B y cancela.
//   4. Comprueba quién recibió qué.
//
// Entradas (solo variables de entorno; nunca archivos ni valores por defecto
// de credenciales):
//   BASE_URL             backend sin /v1: solo http://localhost:<puerto> o http://127.0.0.1:<puerto>
//   RESTAURANT_ID        uuid del restaurante A (Casa 72, el de ADMIN_EMAIL)
//   OTHER_RESTAURANT_ID  uuid de otro restaurante B, abierto y con una mesa libre
//   PARTY_SIZE           personas de las dos reservas (1 a 20)
//   FIREBASE_API_KEY     llave web del proyecto de Firebase
//   QA_PASSWORD          clave de dinnoteam2026+qa21, +qa22 y +qa26
//   ADMIN_EMAIL          correo del restaurant_admin de A
//   ADMIN_PASSWORD       su clave
//   ADMIN2_PASSWORD      clave de dinnoteam2026+qaadmin@gmail.com: restaurant_admin SIN restaurante
//                        en la base local (INSERT de docs/database.md; ver crear-comensales.mjs)
//   CONFIRM=1            envía; sin esto solo es un ensayo (no conecta ni llama a nada)
//
// Nunca imprime ni guarda claves, tokens ni códigos: un campo `code` que llegue
// en un evento no se imprime (y la fila correspondiente sale FALLA).

import { io } from 'socket.io-client';

const QA_DINER_1 = 'dinnoteam2026+qa21@gmail.com';
const QA_DINER_2 = 'dinnoteam2026+qa22@gmail.com';
const QA_NO_PROFILE = 'dinnoteam2026+qa26@gmail.com';
const ADMIN_WITHOUT_RESTAURANT = 'dinnoteam2026+qaadmin@gmail.com';
const FIREBASE_SIGN_IN_URL =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
const EVENT_WAIT_MS = 1_500; // tras cada acción, para que lleguen los eventos
const FAKE_TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJxYS1mYWxzbyJ9.firma-falsa';
const RESERVATION_EVENTS = [
  'reservation.created',
  'reservation.cancelled',
  'reservation.expired',
  'reservation.checked_in',
];
const ALL_EVENTS = [
  ...RESERVATION_EVENTS,
  'table.status_changed',
  'availability.changed',
];

class ConfigError extends Error {}

function fail(message) {
  throw new ConfigError(message);
}

function readRequired(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    fail(`${name} es obligatoria.`);
  }
  return value;
}

function readUuid(name) {
  const value = readRequired(name).trim().toLowerCase();
  if (!UUID_PATTERN.test(value)) {
    fail(`${name} debe ser un uuid.`);
  }
  return value;
}

function readBaseUrl() {
  let url;
  try {
    url = new URL(readRequired('BASE_URL'));
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    fail('BASE_URL no es una URL válida.');
  }
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    fail(
      'BASE_URL debe ser solo el origen, sin ruta, sin /v1 y sin credenciales.',
    );
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    fail(
      `El host ${url.hostname} no está permitido: solo localhost o 127.0.0.1.`,
    );
  }
  return url.origin;
}

function readConfig() {
  const origin = readBaseUrl();
  const restaurantId = readUuid('RESTAURANT_ID');
  const otherRestaurantId = readUuid('OTHER_RESTAURANT_ID');
  if (restaurantId === otherRestaurantId) {
    fail('OTHER_RESTAURANT_ID debe ser distinto de RESTAURANT_ID.');
  }
  const rawParty = readRequired('PARTY_SIZE').trim();
  const partySize = Number(rawParty);
  if (!/^\d+$/.test(rawParty) || partySize < 1 || partySize > 20) {
    fail('PARTY_SIZE debe ser un entero entre 1 y 20.');
  }
  const adminEmail = readRequired('ADMIN_EMAIL').trim().toLowerCase();
  if (!adminEmail.includes('@')) {
    fail('ADMIN_EMAIL no es un correo.');
  }
  if (adminEmail === ADMIN_WITHOUT_RESTAURANT) {
    fail(`ADMIN_EMAIL debe ser el admin de A, no ${ADMIN_WITHOUT_RESTAURANT}.`);
  }
  return {
    origin,
    restaurantId,
    otherRestaurantId,
    partySize,
    apiKey: readRequired('FIREBASE_API_KEY'),
    qaPassword: readRequired('QA_PASSWORD'),
    adminEmail,
    adminPassword: readRequired('ADMIN_PASSWORD'),
    admin2Password: readRequired('ADMIN2_PASSWORD'),
    confirm: process.env.CONFIRM === '1',
  };
}

// Sin el mensaje completo de fetch: nunca incluye cabeceras ni la URL con la llave.
function networkError(error) {
  if (error?.name === 'TimeoutError') {
    return 'tiempo de espera agotado';
  }
  return `error de red (${error?.cause?.code ?? error?.name ?? 'desconocido'})`;
}

// Firebase responde { error: { message: "CODIGO : detalle" } }: solo el código.
function firebaseErrorCode(json) {
  const message = json?.error?.message;
  return typeof message === 'string'
    ? message.split(/[\s:]/)[0]
    : 'ERROR_DESCONOCIDO';
}

async function signIn(apiKey, email, password) {
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
    return response.ok && typeof json?.idToken === 'string'
      ? { token: json.idToken }
      : { error: firebaseErrorCode(json) };
  } catch (error) {
    return { error: networkError(error) };
  }
}

function makeApi(origin) {
  return async (method, path, token, body) => {
    try {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json = await response.json().catch(() => null);
      return { status: response.status, json };
    } catch (error) {
      return { status: null, error: networkError(error) };
    }
  };
}

// «HTTP 409 · NO_TABLE_AVAILABLE». Nunca incluye el cuerpo (podría traer el código).
function describe(result) {
  if (result.status === null) {
    return result.error;
  }
  return `HTTP ${result.status}${result.json?.errorCode ? ` · ${result.json.errorCode}` : ''}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = () => new Date().toLocaleTimeString('es-CO', { hour12: false });

// Sin `code` (el código de check-in nunca se imprime, aunque llegue por error).
function printable(payload) {
  if (payload === null || typeof payload !== 'object') {
    return JSON.stringify(payload);
  }
  const { code, ...rest } = payload;
  return `${JSON.stringify(rest)}${code === undefined ? '' : ' [traía «code»: oculto]'}`;
}

// Conecta con el token (auth como función, como pide §10) o sin él. Resuelve con
// { socket } o { error: código del connect_error }. Sin reconexión.
function connect(origin, token) {
  return new Promise((resolve) => {
    const socket = io(origin, {
      auth: (cb) => cb(token === undefined ? {} : { token }),
      transports: ['websocket'],
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
    });
    const timer = setTimeout(() => {
      socket.close();
      resolve({ error: 'sin respuesta (tiempo de espera)' });
    }, CONNECT_TIMEOUT_MS + 1_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve({ socket });
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      resolve({ error: error?.message ?? 'desconocido' });
    });
  });
}

// Anota e imprime cada evento que recibe un socket.
function listen(name, socket) {
  const received = [];
  for (const event of ALL_EVENTS) {
    socket.on(event, (payload) => {
      received.push({ event, payload });
      console.log(`[${clock()}] ${name} ← ${event} ${printable(payload)}`);
    });
  }
  return received;
}

async function signInAll(config) {
  const accounts = [
    ['admin', config.adminEmail, config.adminPassword],
    ['admin2', ADMIN_WITHOUT_RESTAURANT, config.admin2Password],
    ['diner1', QA_DINER_1, config.qaPassword],
    ['diner2', QA_DINER_2, config.qaPassword],
    ['noProfile', QA_NO_PROFILE, config.qaPassword],
  ];
  const tokens = {};
  for (const [key, email, password] of accounts) {
    const result = await signIn(config.apiKey, email, password);
    if (result.error) {
      console.error(
        `No se pudo iniciar sesión con ${email} (${result.error}); no se conectó nada.`,
      );
      return null;
    }
    tokens[key] = result.token;
  }
  return tokens;
}

// Antes de crear nada. Devuelve { problem } o { tablesOfA }.
async function preflight(config, api, tokens) {
  const health = await api('GET', '/v1/health');
  if (health.status !== 200) {
    return {
      problem: `el backend no respondió el health (${describe(health)})`,
    };
  }
  const me = await api('GET', '/v1/restaurants/me', tokens.admin);
  if (
    me.status !== 200 ||
    String(me.json?.id).toLowerCase() !== config.restaurantId
  ) {
    return {
      problem: `el restaurante de ADMIN_EMAIL no es RESTAURANT_ID (${describe(me)})`,
    };
  }
  for (const [label, id] of [
    ['A', config.restaurantId],
    ['B', config.otherRestaurantId],
  ]) {
    const detail = await api(
      'GET',
      `/v1/restaurants/${id}/public`,
      tokens.diner1,
    );
    if (detail.status !== 200 || detail.json?.isOpenNow !== true) {
      return {
        problem: `el restaurante ${label} no está abierto ahora (${describe(detail)})`,
      };
    }
  }
  for (const [key, email] of [
    ['diner1', QA_DINER_1],
    ['diner2', QA_DINER_2],
  ]) {
    const active = await api('GET', '/v1/reservations/active', tokens[key]);
    if (active.status !== 200) {
      return {
        problem: `${email}: no se pudo consultar su reserva activa (${describe(active)})`,
      };
    }
    if (active.json?.reservation) {
      return {
        problem: `${email} ya tiene una reserva activa: cancélala o espera a que venza`,
      };
    }
  }
  const tables = await api('GET', '/v1/tables', tokens.admin);
  if (tables.status !== 200 || !Array.isArray(tables.json)) {
    return {
      problem: `no se pudieron leer las mesas de A (${describe(tables)})`,
    };
  }
  return { tablesOfA: new Set(tables.json.map((t) => t.id)) };
}

class T1SocketRun {
  constructor(config, api, tokens) {
    this.config = config;
    this.api = api;
    this.tokens = tokens;
    this.rows = [];
    this.notes = [];
  }

  row(id, caso, esperado, real, pasa) {
    this.rows.push({
      id,
      caso,
      esperado,
      real,
      veredicto: pasa ? 'PASA' : 'FALLA',
    });
  }

  // Filas 10, 11 y 12: conexiones que el servidor debe rechazar.
  async rejections() {
    const cases = [
      [
        '10',
        `Admin sin restaurante (${ADMIN_WITHOUT_RESTAURANT})`,
        this.tokens.admin2,
        'RESTAURANT_REQUIRED',
      ],
      ['11a', 'Sin token', undefined, 'UNAUTHORIZED'],
      ['11b', 'Token falso', FAKE_TOKEN, 'UNAUTHORIZED'],
      [
        '12',
        `Cuenta sin perfil (${QA_NO_PROFILE})`,
        this.tokens.noProfile,
        'PROFILE_REQUIRED',
      ],
    ];
    for (const [id, caso, token, expected] of cases) {
      const result = await connect(this.config.origin, token);
      if (result.socket) {
        result.socket.close();
        this.row(id, caso, `connect_error ${expected}`, 'se conectó', false);
        continue;
      }
      console.log(`[${clock()}] ${caso} → connect_error ${result.error}`);
      this.row(
        id,
        caso,
        `connect_error ${expected}`,
        `connect_error ${result.error}`,
        result.error === expected,
      );
    }
  }

  // Conecta a los tres que escuchan. Devuelve false si alguno no pudo.
  async connectListeners() {
    this.sockets = {};
    this.received = {};
    const listeners = [
      ['diner1', 'qa21', '7a', 'qa21 (comensal) se conecta'],
      ['diner2', 'qa22', '7b', 'qa22 (comensal) se conecta'],
      ['admin', 'Casa 72', '8a', 'Admin de A se conecta'],
    ];
    let allConnected = true;
    for (const [key, name, id, caso] of listeners) {
      const result = await connect(this.config.origin, this.tokens[key]);
      this.row(
        id,
        caso,
        'conectado',
        result.socket ? 'conectado' : `connect_error ${result.error}`,
        Boolean(result.socket),
      );
      if (result.socket) {
        this.sockets[key] = result.socket;
        this.received[key] = listen(name, result.socket);
      } else {
        allConnected = false;
      }
    }
    return allConnected;
  }

  closeAll() {
    for (const socket of Object.values(this.sockets ?? {})) {
      socket.close();
    }
  }

  async reserve(tokenKey, restaurantId) {
    const result = await this.api(
      'POST',
      '/v1/reservations',
      this.tokens[tokenKey],
      { restaurantId, partySize: this.config.partySize },
    );
    return result.status === 201 && typeof result.json?.code === 'string'
      ? { reservation: result.json }
      : { error: describe(result) };
  }

  async tableIdOf(reservationId) {
    const list = await this.api(
      'GET',
      '/v1/restaurants/me/reservations?status=active',
      this.tokens.admin,
    );
    return Array.isArray(list.json)
      ? (list.json.find((r) => r.id === reservationId)?.tableId ?? null)
      : null;
  }

  // Genera los eventos. Guarda lo creado para revisar y limpiar.
  async generateEvents() {
    console.log(`\n[${clock()}] qa21 reserva en A…`);
    const first = await this.reserve('diner1', this.config.restaurantId);
    if (first.error) {
      this.notes.push(`qa21 no pudo reservar en A (${first.error}).`);
      return false;
    }
    this.r1 = first.reservation;
    this.tableA = await this.tableIdOf(this.r1.id);
    await sleep(EVENT_WAIT_MS);

    console.log(`[${clock()}] El admin de A hace el check-in…`);
    const checkIn = await this.api(
      'POST',
      '/v1/restaurants/me/check-ins',
      this.tokens.admin,
      { code: this.r1.code },
    );
    this.checkedIn = checkIn.status === 200;
    if (!this.checkedIn) {
      this.notes.push(`El check-in falló (${describe(checkIn)}).`);
    }
    await sleep(EVENT_WAIT_MS);
    if (this.checkedIn && this.tableA) {
      console.log(`[${clock()}] El admin deja la mesa en Disponible…`);
      const restore = await this.api(
        'PATCH',
        `/v1/tables/${this.tableA}/status`,
        this.tokens.admin,
        { status: 'available' },
      );
      if (restore.status !== 200) {
        this.notes.push(
          `No se pudo dejar la mesa en Disponible (${describe(restore)}): hazlo en la web.`,
        );
      }
      await sleep(EVENT_WAIT_MS);
    }

    console.log(`[${clock()}] qa22 reserva en B y cancela…`);
    const second = await this.reserve('diner2', this.config.otherRestaurantId);
    if (second.error) {
      this.notes.push(`qa22 no pudo reservar en B (${second.error}).`);
      return true;
    }
    this.r2 = second.reservation;
    await sleep(EVENT_WAIT_MS);
    const cancel = await this.api(
      'POST',
      `/v1/reservations/${this.r2.id}/cancel`,
      this.tokens.diner2,
    );
    this.r2Cancelled = cancel.status === 200;
    await sleep(EVENT_WAIT_MS);
    return true;
  }

  // Si algo quedó a medias, lo deja como estaba.
  async cleanup() {
    for (const [reservation, tokenKey] of [
      [this.r1, 'diner1'],
      [this.r2, 'diner2'],
    ]) {
      if (!reservation) {
        continue;
      }
      const view = await this.api(
        'GET',
        `/v1/reservations/${reservation.id}`,
        this.tokens[tokenKey],
      );
      if (view.json?.status === 'active') {
        const cancel = await this.api(
          'POST',
          `/v1/reservations/${reservation.id}/cancel`,
          this.tokens[tokenKey],
        );
        if (cancel.status !== 200) {
          this.notes.push(
            `No se pudo cancelar la reserva ${reservation.id} (${describe(cancel)}); vence sola.`,
          );
        }
      }
    }
  }

  // Filas 7 a 9 y 13: quién recibió qué.
  evaluate(tablesOfA) {
    const of = (key) => this.received[key] ?? [];
    const names = (events) =>
      events.length === 0 ? 'ninguno' : events.map((e) => e.event).join(', ');
    const aboutR = (e, id) =>
      e.payload?.id === id || e.payload?.reservationId === id;
    const r1 = this.r1?.id;
    const r2 = this.r2?.id;

    // Fila 7: el comensal.
    const d1 = of('diner1');
    this.row(
      '7c',
      'qa21 recibe availability.changed (sala diners)',
      'al menos uno',
      `${d1.filter((e) => e.event === 'availability.changed').length}`,
      d1.some((e) => e.event === 'availability.changed'),
    );
    const d1Forbidden = d1.filter(
      (e) =>
        e.event === 'reservation.created' || e.event === 'table.status_changed',
    );
    this.row(
      '7d',
      'qa21 no recibe reservation.created ni table.status_changed',
      'ninguno',
      names(d1Forbidden),
      d1Forbidden.length === 0,
    );

    // Fila 8: el restaurante.
    const ad = of('admin');
    const created = ad.find(
      (e) => e.event === 'reservation.created' && e.payload?.id === r1,
    );
    this.row(
      '8b',
      'Admin de A recibe reservation.created de qa21, sin código',
      'sí, sin «code»',
      created
        ? `sí${created.payload.code === undefined ? ', sin «code»' : ', CON «code»'}`
        : 'no',
      Boolean(created) && created.payload.code === undefined,
    );
    const reservedChange = ad.find(
      (e) =>
        e.event === 'table.status_changed' &&
        e.payload?.tableId === this.tableA &&
        e.payload?.status === 'reserved' &&
        e.payload?.source === 'reservation',
    );
    this.row(
      '8c',
      'Admin de A recibe table.status_changed (→ reserved, reservation)',
      'sí',
      reservedChange ? 'sí' : 'no',
      Boolean(reservedChange),
    );
    const adAvailability = ad.filter((e) => e.event === 'availability.changed');
    this.row(
      '8d',
      'Admin de A no recibe availability.changed',
      'ninguno',
      `${adAvailability.length}`,
      adAvailability.length === 0,
    );

    // Fila 9: cada sala solo lo suyo.
    const adForeign = ad.filter(
      (e) =>
        (r2 && aboutR(e, r2)) ||
        (e.event === 'table.status_changed' &&
          !tablesOfA.has(e.payload?.tableId)),
    );
    this.row(
      '9a',
      'Admin de A no recibe eventos de B',
      'ninguno',
      r2 ? names(adForeign) : 'sin reserva en B',
      Boolean(r2) && adForeign.length === 0,
    );
    const d1Foreign = d1.filter(
      (e) => RESERVATION_EVENTS.includes(e.event) && r2 && aboutR(e, r2),
    );
    const d2Foreign = of('diner2').filter(
      (e) => RESERVATION_EVENTS.includes(e.event) && r1 && aboutR(e, r1),
    );
    this.row(
      '9b',
      'Un comensal no recibe eventos de reserva del otro',
      'ninguno',
      `qa21: ${names(d1Foreign)} · qa22: ${names(d2Foreign)}`,
      Boolean(r1 && r2) && d1Foreign.length === 0 && d2Foreign.length === 0,
    );
    const ownCancel = of('diner2').some(
      (e) =>
        e.event === 'reservation.cancelled' &&
        e.payload?.reservationId === r2 &&
        e.payload?.status === 'cancelled',
    );
    this.row(
      '9c',
      'Control: qa22 sí recibe su reservation.cancelled',
      'sí',
      ownCancel ? 'sí' : 'no',
      ownCancel,
    );

    // Fila 13: el check-in llega al comensal (y al restaurante, §12.8).
    const isCheckIn = (e) =>
      e.event === 'reservation.checked_in' &&
      e.payload?.reservationId === r1 &&
      e.payload?.status === 'completed' &&
      e.payload?.tableId === this.tableA &&
      typeof e.payload?.at === 'string';
    this.row(
      '13a',
      'qa21 recibe reservation.checked_in { reservationId, completed, tableId, at }',
      'sí',
      d1.some(isCheckIn) ? 'sí' : 'no',
      d1.some(isCheckIn),
    );
    this.row(
      '13b',
      'Admin de A también recibe reservation.checked_in',
      'sí',
      ad.some(isCheckIn) ? 'sí' : 'no',
      ad.some(isCheckIn),
    );

    // Ningún evento de reserva trae el código.
    const withCode = Object.values(this.received)
      .flat()
      .filter((e) => e.payload && e.payload.code !== undefined);
    this.row(
      '13c',
      'Ningún evento trae el código de la reserva',
      'ninguno',
      names(withCode),
      withCode.length === 0,
    );
  }
}

function printTable(rows) {
  const headers = {
    id: 'Fila',
    caso: 'Caso',
    esperado: 'Esperado',
    real: 'Real',
    veredicto: 'Veredicto',
  };
  const keys = Object.keys(headers);
  const widths = keys.map((key) =>
    Math.max(
      headers[key].length,
      ...rows.map((row) => String(row[key]).length),
    ),
  );
  const line = (values) =>
    `| ${values.map((value, i) => String(value).padEnd(widths[i])).join(' | ')} |`;
  console.log(line(keys.map((key) => headers[key])));
  console.log(`|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`);
  for (const row of rows) {
    console.log(line(keys.map((key) => row[key])));
  }
}

async function main() {
  const config = readConfig();

  console.log(`BASE_URL:            ${config.origin}`);
  console.log(`RESTAURANT_ID (A):   ${config.restaurantId}`);
  console.log(`OTHER_RESTAURANT_ID: ${config.otherRestaurantId}`);
  console.log(`PARTY_SIZE:          ${config.partySize}`);
  console.log(`Admin de A:          ${config.adminEmail}`);
  console.log(`Admin sin rest.:     ${ADMIN_WITHOUT_RESTAURANT}`);
  console.log(
    `Comensales:          ${QA_DINER_1}, ${QA_DINER_2}, ${QA_NO_PROFILE} (sin perfil)`,
  );
  console.log(
    '\n⚠ Escribe en la base que use ese backend (en local, la de su DATABASE_URL): una reserva con check-in en A (fila en check_ins) y una reserva cancelada en B.',
  );
  console.log(
    '  El backend debe correr con DEV_USER_ENABLED=false: con el usuario de desarrollo ignora los tokens.',
  );

  if (!config.confirm) {
    console.log(
      '\nEnsayo: no se llamó a Firebase, al backend ni al WebSocket. Para enviar, repite con CONFIRM=1.',
    );
    return 0;
  }

  const tokens = await signInAll(config);
  if (!tokens) {
    return 2;
  }
  const api = makeApi(config.origin);
  const check = await preflight(config, api, tokens);
  if (check.problem) {
    console.error(`No se puede empezar: ${check.problem}. No se creó nada.`);
    return 2;
  }

  const run = new T1SocketRun(config, api, tokens);
  await run.rejections();
  try {
    if (await run.connectListeners()) {
      if (await run.generateEvents()) {
        run.evaluate(check.tablesOfA);
      }
    } else {
      run.notes.push(
        'No se conectaron los tres sockets que escuchan: no se generaron eventos.',
      );
    }
  } finally {
    run.closeAll();
    await run.cleanup();
  }

  console.log('');
  printTable(run.rows);
  for (const note of run.notes) {
    console.log(`\nAviso: ${note}`);
  }
  const failed = run.rows.filter((row) => row.veredicto === 'FALLA').length;
  const incomplete = run.notes.length > 0;
  console.log(
    `\nT1 (WebSocket): ${run.rows.length - failed} PASA · ${failed} FALLA${incomplete ? ' · con avisos' : ''}.`,
  );
  return failed === 0 && !incomplete ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`Configuración inválida: ${error.message} No se envió nada.`);
    process.exitCode = 2;
  } else {
    console.error(
      `Error inesperado (${error?.name ?? 'desconocido'}). No se muestran detalles para no exponer datos.`,
    );
    process.exitCode = 1;
  }
}
