// QA del Sprint 3, caso M9 (docs/qa/sprint3-jacobo.md): check-in con códigos
// válidos e inválidos contra el backend LOCAL, con cuentas reales de Firebase.
// Contratos: CLAUDE.md §12.6, §12.8 y §12.9 (y §11 «Check-in» para los 400).
// Solo usa Node 24 y su fetch.
//
// Entradas (solo variables de entorno; nunca archivos ni valores por defecto
// de credenciales):
//   BASE_URL             backend sin /v1: solo http://localhost:<puerto> o http://127.0.0.1:<puerto>
//   RESTAURANT_ID        uuid del restaurante A (el del administrador)
//   OTHER_RESTAURANT_ID  uuid de otro restaurante B, abierto y con una mesa libre (fila 9)
//   PARTY_SIZE           personas por reserva (1 a 20)
//   FIREBASE_API_KEY     llave web del proyecto de Firebase
//   QA_PASSWORD          clave de dinnoteam2026+qa21 y +qa22 (scripts/qa/crear-comensales.mjs)
//   ADMIN_EMAIL          correo del restaurant_admin de A
//   ADMIN_PASSWORD       su clave
//   INCLUDE_EXPIRED=1    corre la fila 7 (espera a que venza una reserva: RESERVATION_TTL_MINUTES)
//   CONFIRM=1            envía; sin esto solo es un ensayo (no llama a nada)
//
// Nunca imprime ni guarda claves, tokens ni códigos de reserva: los códigos solo
// viven en memoria. Después de cada check-in válido deja la mesa en Disponible.

const QA_DINER_A = 'dinnoteam2026+qa21@gmail.com'; // reserva en A, una tras otra
const QA_DINER_B = 'dinnoteam2026+qa22@gmail.com'; // reserva en B (fila 9)
const FIREBASE_SIGN_IN_URL =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;
const EXPIRY_MARGIN_MS = 3_000;
const USED_MESSAGE = /^Este código ya se usó a las \d{2}:\d{2}\.$/;
const EXPIRED_MESSAGE =
  /^Esta reserva se venció a las \d{2}:\d{2}\. La mesa ya se liberó\.$/;

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
  const value = readRequired(name).trim();
  if (!UUID_PATTERN.test(value)) {
    fail(`${name} debe ser un uuid.`);
  }
  return value.toLowerCase();
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
  const qaPassword = readRequired('QA_PASSWORD');
  const adminPassword = readRequired('ADMIN_PASSWORD');
  const adminEmail = readRequired('ADMIN_EMAIL').trim().toLowerCase();
  if (!adminEmail.includes('@')) {
    fail('ADMIN_EMAIL no es un correo.');
  }
  return {
    origin,
    restaurantId,
    otherRestaurantId,
    partySize,
    apiKey: readRequired('FIREBASE_API_KEY'),
    qaPassword,
    adminEmail,
    adminPassword,
    includeExpired: process.env.INCLUDE_EXPIRED === '1',
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

// Cliente del backend: { status, json } o { status: null, error }.
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

// «HTTP 409 · RESERVATION_EXPIRED». Nunca incluye el cuerpo (podría traer el código).
function describe(result) {
  if (result.status === null) {
    return result.error;
  }
  return `HTTP ${result.status}${result.json?.errorCode ? ` · ${result.json.errorCode}` : ''}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mismo código, en minúsculas y con espacios (fila 4): « k7m 4qx ».
function messyVariant(code) {
  const lower = code.toLowerCase();
  return ` ${lower.slice(0, 3)} ${lower.slice(3)} `;
}

class M9Run {
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
      veredicto: pasa === null ? 'OMITIDA' : pasa ? 'PASA' : 'FALLA',
    });
  }

  // Reserva del comensal; el código queda solo en memoria.
  async reserve(dinerToken, restaurantId) {
    const result = await this.api('POST', '/v1/reservations', dinerToken, {
      restaurantId,
      partySize: this.config.partySize,
    });
    if (result.status === 201 && typeof result.json?.code === 'string') {
      return { reservation: result.json };
    }
    return { error: `preparación: reservar → ${describe(result)}` };
  }

  checkIn(code) {
    return this.api(
      'POST',
      '/v1/restaurants/me/check-ins',
      this.tokens.admin,
      code === undefined ? {} : { code },
    );
  }

  // La reserva del restaurante trae tableId; la del comensal solo el identificador.
  async tableIdOf(reservationId) {
    const result = await this.api(
      'GET',
      '/v1/restaurants/me/reservations?status=active',
      this.tokens.admin,
    );
    if (result.status !== 200 || !Array.isArray(result.json)) {
      return null;
    }
    return result.json.find((r) => r.id === reservationId)?.tableId ?? null;
  }

  async restoreTable(tableId) {
    const result = await this.api(
      'PATCH',
      `/v1/tables/${tableId}/status`,
      this.tokens.admin,
      { status: 'available' },
    );
    if (result.status !== 200) {
      this.notes.push(
        `No se pudo dejar la mesa ${tableId} en Disponible (${describe(result)}): hazlo en la web.`,
      );
    }
  }

  // Filas 1, 2, 3 y 5: un check-in válido y sus efectos.
  async validCheckIn() {
    const prepared = await this.reserve(
      this.tokens.dinerA,
      this.config.restaurantId,
    );
    if (prepared.error) {
      for (const id of ['1', '2', '3', '5']) {
        this.row(id, 'Check-in válido', '—', prepared.error, false);
      }
      return;
    }
    const { reservation } = prepared;
    const tableId = await this.tableIdOf(reservation.id);

    const result = await this.checkIn(reservation.code);
    const body = result.json ?? {};
    this.row(
      '1',
      'Código válido, tal cual',
      '200 con los datos de la reserva',
      describe(result),
      result.status === 200 &&
        body.reservationId === reservation.id &&
        body.tableIdentifier === reservation.table?.identifier &&
        body.partySize === this.config.partySize &&
        typeof body.checkedInAt === 'string',
    );

    await this.checkEffects(tableId);

    const view = await this.api(
      'GET',
      `/v1/reservations/${reservation.id}`,
      this.tokens.dinerA,
    );
    this.row(
      '3',
      'El comensal ve su reserva',
      '200 · completed · checkedInAt · code null',
      `${describe(view)}${view.json?.status ? ` · ${view.json.status}` : ''}`,
      view.status === 200 &&
        view.json?.status === 'completed' &&
        typeof view.json?.checkedInAt === 'string' &&
        view.json?.code === null,
    );

    if (tableId) {
      await this.restoreTable(tableId);
    }

    const again = await this.checkIn(reservation.code);
    this.row(
      '5',
      'Ya usado (mismo código)',
      '409 · RESERVATION_ALREADY_USED · «ya se usó a las HH:mm»',
      describe(again),
      again.status === 409 &&
        again.json?.errorCode === 'RESERVATION_ALREADY_USED' &&
        USED_MESSAGE.test(again.json?.message ?? ''),
    );
  }

  // Fila 2: mesa Ocupada y bitácora reserved → occupied con el correo del admin.
  async checkEffects(tableId) {
    const expected =
      'mesa occupied · bitácora reserved→occupied, reservation, correo del admin';
    if (!tableId) {
      this.row(
        '2',
        'Mesa y bitácora',
        expected,
        'no se encontró la mesa',
        false,
      );
      return;
    }
    const tables = await this.api('GET', '/v1/tables', this.tokens.admin);
    const status = Array.isArray(tables.json)
      ? tables.json.find((t) => t.id === tableId)?.status
      : undefined;
    const logs = await this.api(
      'GET',
      `/v1/table-logs?tableId=${tableId}`,
      this.tokens.admin,
    );
    const last = Array.isArray(logs.json) ? logs.json[0] : undefined;
    const adminEmailMatches =
      typeof last?.userEmail === 'string' &&
      last.userEmail.toLowerCase() === this.config.adminEmail;
    const logOk =
      last?.previousStatus === 'reserved' &&
      last?.newStatus === 'occupied' &&
      last?.source === 'reservation';
    this.row(
      '2',
      'Mesa y bitácora',
      expected,
      `mesa ${status ?? '?'} · bitácora ${last ? `${last.previousStatus}→${last.newStatus}, ${last.source}` : '?'} · correo del admin: ${adminEmailMatches ? 'sí' : 'no'}`,
      status === 'occupied' && logOk && adminEmailMatches,
    );
  }

  // Fila 4: el mismo flujo con el código en minúsculas y con espacios.
  async messyCheckIn() {
    const prepared = await this.reserve(
      this.tokens.dinerA,
      this.config.restaurantId,
    );
    if (prepared.error) {
      this.row('4', 'Minúsculas y espacios', '200', prepared.error, false);
      return;
    }
    const { reservation } = prepared;
    const tableId = await this.tableIdOf(reservation.id);
    const result = await this.checkIn(messyVariant(reservation.code));
    this.row(
      '4',
      'Minúsculas y espacios',
      '200',
      describe(result),
      result.status === 200 && result.json?.reservationId === reservation.id,
    );
    if (result.status === 200 && tableId) {
      await this.restoreTable(tableId);
    }
  }

  // Fila 6: el comensal cancela y luego el restaurante escribe el código.
  async cancelledCheckIn() {
    const expected = '409 · RESERVATION_CANCELLED';
    const prepared = await this.reserve(
      this.tokens.dinerA,
      this.config.restaurantId,
    );
    if (prepared.error) {
      this.row('6', 'Cancelado', expected, prepared.error, false);
      return;
    }
    const { reservation } = prepared;
    const cancel = await this.api(
      'POST',
      `/v1/reservations/${reservation.id}/cancel`,
      this.tokens.dinerA,
    );
    if (cancel.status !== 200) {
      this.row(
        '6',
        'Cancelado',
        expected,
        `preparación: cancelar → ${describe(cancel)}`,
        false,
      );
      return;
    }
    const result = await this.checkIn(reservation.code);
    this.row(
      '6',
      'Cancelado',
      expected,
      describe(result),
      result.status === 409 &&
        result.json?.errorCode === 'RESERVATION_CANCELLED',
    );
  }

  // Fila 7: espera a que pase expiresAt (según la hora del servidor) y escribe el código.
  async expiredCheckIn() {
    const expected = '409 · RESERVATION_EXPIRED · «se venció a las HH:mm»';
    if (!this.config.includeExpired) {
      this.row('7', 'Vencido', expected, 'sin INCLUDE_EXPIRED=1', null);
      return;
    }
    const prepared = await this.reserve(
      this.tokens.dinerA,
      this.config.restaurantId,
    );
    if (prepared.error) {
      this.row('7', 'Vencido', expected, prepared.error, false);
      return;
    }
    const { reservation } = prepared;
    const remainingMs =
      Date.parse(reservation.expiresAt) - Date.parse(reservation.serverTime);
    const waitMs = Math.max(0, remainingMs) + EXPIRY_MARGIN_MS;
    console.log(
      `Fila 7: esperando ${Math.round(waitMs / 1000)} s a que venza la reserva…`,
    );
    await sleep(waitMs);
    const result = await this.checkIn(reservation.code);
    this.row(
      '7',
      'Vencido',
      expected,
      describe(result),
      result.status === 409 &&
        result.json?.errorCode === 'RESERVATION_EXPIRED' &&
        EXPIRED_MESSAGE.test(result.json?.message ?? ''),
    );
  }

  // Filas 9 y 10: un código activo de B, escrito por el admin de A.
  async otherRestaurant() {
    const prepared = await this.reserve(
      this.tokens.dinerB,
      this.config.otherRestaurantId,
    );
    if (prepared.error) {
      this.row(
        '9',
        'De otro restaurante',
        '404 · RESERVATION_CODE_NOT_FOUND',
        prepared.error,
        false,
      );
      this.row(
        '10',
        'La reserva de B sigue activa',
        '200 · active',
        prepared.error,
        false,
      );
      return;
    }
    const { reservation } = prepared;
    const result = await this.checkIn(reservation.code);
    this.row(
      '9',
      'De otro restaurante',
      '404 · RESERVATION_CODE_NOT_FOUND',
      describe(result),
      result.status === 404 &&
        result.json?.errorCode === 'RESERVATION_CODE_NOT_FOUND',
    );
    const view = await this.api(
      'GET',
      `/v1/reservations/${reservation.id}`,
      this.tokens.dinerB,
    );
    this.row(
      '10',
      'La reserva de B sigue activa',
      '200 · active',
      `${describe(view)}${view.json?.status ? ` · ${view.json.status}` : ''}`,
      view.status === 200 && view.json?.status === 'active',
    );
    const cancel = await this.api(
      'POST',
      `/v1/reservations/${reservation.id}/cancel`,
      this.tokens.dinerB,
    );
    if (cancel.status !== 200) {
      this.notes.push(
        `No se pudo cancelar la reserva de prueba en B (${describe(cancel)}): vence sola.`,
      );
    }
  }

  // Filas 8, 11, 12, 13 y 14: entradas sin reserva detrás.
  async invalidInputs() {
    const notFound = [
      ['8', 'Inexistente (formato correcto)', 'ZZZZZZ'],
      ['11a', 'Formato: corto', 'ABC'],
      ['11b', 'Formato: largo', 'K7M4QX9'],
      ['11c', 'Formato: con 0 (fuera del alfabeto)', 'K7M4Q0'],
      ['11d', 'Formato: con símbolo', 'K7-M4Q'],
      ['12a', 'Vacío', ''],
      ['12b', 'Solo espacios', '   '],
    ];
    for (const [id, caso, code] of notFound) {
      const result = await this.checkIn(code);
      this.row(
        id,
        caso,
        '404 · RESERVATION_CODE_NOT_FOUND',
        describe(result),
        result.status === 404 &&
          result.json?.errorCode === 'RESERVATION_CODE_NOT_FOUND',
      );
    }
    const badRequest = [
      ['13', 'Sin code ({})', undefined],
      ['14a', 'code numérico', 123456],
      ['14b', 'code null', null],
    ];
    for (const [id, caso, code] of badRequest) {
      const result = await this.checkIn(code);
      this.row(
        id,
        caso,
        '400 sin errorCode',
        describe(result),
        result.status === 400 && result.json?.errorCode === undefined,
      );
    }
  }
}

async function signInAll(config) {
  const accounts = [
    ['admin', config.adminEmail, config.adminPassword],
    ['dinerA', QA_DINER_A, config.qaPassword],
    ['dinerB', QA_DINER_B, config.qaPassword],
  ];
  const tokens = {};
  for (const [key, email, password] of accounts) {
    const result = await signIn(config.apiKey, email, password);
    if (result.error) {
      console.error(
        `No se pudo iniciar sesión con ${email} (${result.error}); no se envió nada al backend.`,
      );
      return null;
    }
    tokens[key] = result.token;
  }
  return tokens;
}

// Antes de empezar: el admin es de A y los comensales no tienen reserva activa.
async function preflight(config, api, tokens) {
  const health = await api('GET', '/v1/health');
  if (health.status !== 200) {
    return `el backend no respondió el health (${describe(health)})`;
  }
  const me = await api('GET', '/v1/restaurants/me', tokens.admin);
  if (me.status !== 200) {
    return `ADMIN_EMAIL no es un restaurante con restaurante registrado (${describe(me)})`;
  }
  if (String(me.json?.id).toLowerCase() !== config.restaurantId) {
    return 'el restaurante de ADMIN_EMAIL no es RESTAURANT_ID';
  }
  for (const [key, email] of [
    ['dinerA', QA_DINER_A],
    ['dinerB', QA_DINER_B],
  ]) {
    const active = await api('GET', '/v1/reservations/active', tokens[key]);
    if (active.status !== 200) {
      return `${email}: no se pudo consultar su reserva activa (${describe(active)})`;
    }
    if (active.json?.reservation) {
      return `${email} ya tiene una reserva activa: cancélala o espera a que venza`;
    }
  }
  return null;
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

// «1», «2», «11a», «11b»… en orden numérico.
function byRowId(a, b) {
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

async function main() {
  const config = readConfig();

  console.log(`BASE_URL:            ${config.origin}`);
  console.log(`RESTAURANT_ID (A):   ${config.restaurantId}`);
  console.log(`OTHER_RESTAURANT_ID: ${config.otherRestaurantId}`);
  console.log(`PARTY_SIZE:          ${config.partySize}`);
  console.log(`Administrador de A:  ${config.adminEmail}`);
  console.log(`Comensales:          ${QA_DINER_A} (A), ${QA_DINER_B} (B)`);
  console.log(
    `Fila 7 (vencido):    ${config.includeExpired ? 'sí (espera RESERVATION_TTL_MINUTES)' : 'no (INCLUDE_EXPIRED=1 para incluirla)'}`,
  );
  console.log(
    '\n⚠ Escribe en la base que use ese backend (en local, la de su DATABASE_URL): crea y cancela reservas, hace check-ins (filas en check_ins), cambia mesas y deja filas en la bitácora.',
  );
  console.log(
    '  El backend debe correr con DEV_USER_ENABLED=false: con el usuario de desarrollo ignora los tokens.',
  );

  if (!config.confirm) {
    console.log(
      '\nEnsayo: no se llamó a Firebase ni al backend. Para enviar, repite con CONFIRM=1.',
    );
    return 0;
  }

  const tokens = await signInAll(config);
  if (!tokens) {
    return 2;
  }
  const api = makeApi(config.origin);
  const problem = await preflight(config, api, tokens);
  if (problem) {
    console.error(`No se puede empezar: ${problem}. No se creó nada.`);
    return 2;
  }

  const run = new M9Run(config, api, tokens);
  await run.validCheckIn();
  await run.messyCheckIn();
  await run.cancelledCheckIn();
  await run.expiredCheckIn();
  await run.otherRestaurant();
  await run.invalidInputs();

  const rows = run.rows.sort(byRowId);
  console.log('');
  printTable(rows);
  for (const note of run.notes) {
    console.log(`\nAviso: ${note}`);
  }

  const failed = rows.filter((row) => row.veredicto === 'FALLA').length;
  const skipped = rows.filter((row) => row.veredicto === 'OMITIDA').length;
  console.log(
    `\nM9: ${rows.length - failed - skipped} PASA · ${failed} FALLA · ${skipped} OMITIDA.`,
  );
  return failed === 0 ? 0 : 1;
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
