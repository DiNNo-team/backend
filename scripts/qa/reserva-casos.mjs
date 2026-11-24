// QA del Sprint 3, caso M1 (docs/qa/sprint3-jacobo.md): las tres variantes de
// reservar que no salieron en las corridas de concurrencia. Contra el backend
// LOCAL, con cuentas reales de Firebase. Contratos: CLAUDE.md §12.1, §12.8 y
// §12.9 (y §10 para el detalle público cerrado). Solo usa Node 24 y su fetch.
//   (a) restaurante cerrado                          → 409 RESTAURANT_CLOSED
//   (b) 8 personas, sin mesa activa de 8 o más       → 409 NO_TABLE_AVAILABLE
//   (c) comensal con reserva activa pide otra        → 409 ACTIVE_RESERVATION_EXISTS
//
// Entradas (solo variables de entorno; nunca archivos ni valores por defecto
// de credenciales):
//   BASE_URL          backend sin /v1: solo http://localhost:<puerto> o http://127.0.0.1:<puerto>
//   RESTAURANT_ID     uuid del restaurante del administrador (Casa 72)
//   PARTY_SIZE        personas de las reservas normales de (a) y (c) (1 a 7)
//   FIREBASE_API_KEY  llave web del proyecto de Firebase
//   QA_PASSWORD       clave de dinnoteam2026+qa21 y +qa22 (scripts/qa/crear-comensales.mjs)
//   ADMIN_EMAIL       correo del restaurant_admin de RESTAURANT_ID
//   ADMIN_PASSWORD    su clave
//   CONFIRM=1         envía; sin esto solo es un ensayo (no llama a nada)
//
// Deja todo como estaba: cancela cada reserva que crea y, si cierra el
// restaurante para (a), lo vuelve a abrir (también con Ctrl+C). Si la reapertura
// falla, lo dice en grande. Nunca imprime ni guarda claves, tokens ni códigos.

const QA_DINER_1 = 'dinnoteam2026+qa21@gmail.com'; // (c): la reserva activa
const QA_DINER_2 = 'dinnoteam2026+qa22@gmail.com'; // (a) y (b)
const LARGE_PARTY_SIZE = 8;
const FIREBASE_SIGN_IN_URL =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;

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
  const restaurantId = readRequired('RESTAURANT_ID').trim().toLowerCase();
  if (!UUID_PATTERN.test(restaurantId)) {
    fail('RESTAURANT_ID debe ser un uuid.');
  }
  const rawParty = readRequired('PARTY_SIZE').trim();
  const partySize = Number(rawParty);
  if (
    !/^\d+$/.test(rawParty) ||
    partySize < 1 ||
    partySize >= LARGE_PARTY_SIZE
  ) {
    fail(
      `PARTY_SIZE debe ser un entero entre 1 y ${LARGE_PARTY_SIZE - 1} (las reservas normales deben caber).`,
    );
  }
  const adminEmail = readRequired('ADMIN_EMAIL').trim().toLowerCase();
  if (!adminEmail.includes('@')) {
    fail('ADMIN_EMAIL no es un correo.');
  }
  return {
    origin,
    restaurantId,
    partySize,
    apiKey: readRequired('FIREBASE_API_KEY'),
    qaPassword: readRequired('QA_PASSWORD'),
    adminEmail,
    adminPassword: readRequired('ADMIN_PASSWORD'),
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

// «HTTP 409 · RESTAURANT_CLOSED». Nunca incluye el cuerpo (podría traer el código).
function describe(result) {
  if (result.status === null) {
    return result.error;
  }
  return `HTTP ${result.status}${result.json?.errorCode ? ` · ${result.json.errorCode}` : ''}`;
}

function isError(result, status, errorCode) {
  return result.status === status && result.json?.errorCode === errorCode;
}

async function signInAll(config) {
  const accounts = [
    ['admin', config.adminEmail, config.adminPassword],
    ['diner1', QA_DINER_1, config.qaPassword],
    ['diner2', QA_DINER_2, config.qaPassword],
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

// Antes de crear o cambiar nada. Exige que el restaurante esté Abierto y dentro
// de su horario (si no, (c) daría RESTAURANT_CLOSED por otra razón) y que no
// tenga ninguna mesa activa de 8 o más (si no, (b) no prueba nada).
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
  const status = await api('GET', '/v1/restaurants/me/status', tokens.admin);
  if (status.status !== 200 || status.json?.isOpen !== true) {
    return 'el restaurante no está Abierto: ábrelo en la web antes de correr (el script no cambia el estado inicial)';
  }
  const detail = await api(
    'GET',
    `/v1/restaurants/${config.restaurantId}/public`,
    tokens.diner2,
  );
  if (detail.status !== 200 || detail.json?.isOpenNow !== true) {
    return `el restaurante está fuera de su horario ahora (${describe(detail)}${detail.json ? ` · isOpenNow ${detail.json.isOpenNow}` : ''}): corre el script en su horario`;
  }
  const tables = await api('GET', '/v1/tables', tokens.admin);
  if (tables.status !== 200 || !Array.isArray(tables.json)) {
    return `no se pudieron leer las mesas (${describe(tables)})`;
  }
  const largeActive = tables.json.filter(
    (t) => t.isActive && t.capacity >= LARGE_PARTY_SIZE,
  );
  if (largeActive.length > 0) {
    return `hay mesas activas de ${LARGE_PARTY_SIZE} o más (${largeActive.map((t) => `Mesa ${t.identifier}`).join(', ')}): desactívalas antes de correr la variante (b)`;
  }
  for (const [key, email] of [
    ['diner1', QA_DINER_1],
    ['diner2', QA_DINER_2],
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

class M1Run {
  constructor(config, api, tokens) {
    this.config = config;
    this.api = api;
    this.tokens = tokens;
    this.rows = [];
    this.created = []; // { id, token }: se cancelan todas al final
    this.closed = false; // true mientras el script tenga el restaurante cerrado
    this.reopenFailed = false;
  }

  row(id, caso, esperado, real, pasa) {
    this.rows.push({
      id,
      caso,
      esperado,
      real: typeof real === 'string' ? real : describe(real),
      veredicto: pasa ? 'PASA' : 'FALLA',
    });
  }

  // Toda reserva que el backend acepta (también la que no debía) se anota para cancelarla.
  async reserve(tokenKey, partySize) {
    const result = await this.api(
      'POST',
      '/v1/reservations',
      this.tokens[tokenKey],
      { restaurantId: this.config.restaurantId, partySize },
    );
    if (result.status === 201 && result.json?.id) {
      this.created.push({ id: result.json.id, token: this.tokens[tokenKey] });
    }
    return result;
  }

  // (b) 8 personas sin mesa activa que alcance.
  async largeParty() {
    const result = await this.reserve('diner2', LARGE_PARTY_SIZE);
    this.row(
      'b',
      `${LARGE_PARTY_SIZE} personas, sin mesa activa de ${LARGE_PARTY_SIZE} o más`,
      '409 · NO_TABLE_AVAILABLE',
      result,
      isError(result, 409, 'NO_TABLE_AVAILABLE'),
    );
  }

  // (c) qa21 reserva y pide otra mientras la primera sigue activa.
  async secondReservation() {
    const first = await this.reserve('diner1', this.config.partySize);
    if (first.status !== 201) {
      const text = `preparación: primera reserva → ${describe(first)}`;
      this.row(
        'c1',
        'Segunda reserva del mismo comensal',
        '409 · ACTIVE_RESERVATION_EXISTS',
        text,
        false,
      );
      this.row(
        'c2',
        'La primera reserva sigue siendo la activa',
        '200 · la misma reserva',
        text,
        false,
      );
      return;
    }
    const second = await this.reserve('diner1', this.config.partySize);
    this.row(
      'c1',
      'Segunda reserva del mismo comensal',
      '409 · ACTIVE_RESERVATION_EXISTS',
      second,
      isError(second, 409, 'ACTIVE_RESERVATION_EXISTS'),
    );
    const active = await this.api(
      'GET',
      '/v1/reservations/active',
      this.tokens.diner1,
    );
    const sameOne =
      active.status === 200 && active.json?.reservation?.id === first.json.id;
    this.row(
      'c2',
      'La primera reserva sigue siendo la activa',
      '200 · la misma reserva',
      `${describe(active)} · ${sameOne ? 'la misma' : 'otra o ninguna'}`,
      sameOne,
    );
  }

  async setOpen(isOpen) {
    return this.api('PATCH', '/v1/restaurants/me/status', this.tokens.admin, {
      isOpen,
    });
  }

  // Vuelve a abrir y lo comprueba leyendo el estado. Idempotente.
  async reopen() {
    if (!this.closed) {
      return true;
    }
    const patch = await this.setOpen(true);
    const check = await this.api(
      'GET',
      '/v1/restaurants/me/status',
      this.tokens.admin,
    );
    const ok = check.status === 200 && check.json?.isOpen === true;
    if (ok) {
      this.closed = false;
    } else {
      this.reopenFailed = true;
      this.reopenDetail = `PATCH → ${describe(patch)}; GET → ${describe(check)}`;
    }
    return ok;
  }

  // (a) el administrador cierra, qa22 intenta reservar, y se vuelve a abrir.
  async closedRestaurant() {
    const close = await this.setOpen(false);
    if (close.status !== 200 || close.json?.isOpen !== false) {
      const text = `preparación: cerrar → ${describe(close)}`;
      this.row(
        'a1',
        'Reservar con el restaurante Cerrado',
        '409 · RESTAURANT_CLOSED',
        text,
        false,
      );
      this.row(
        'a2',
        'Detalle público con el restaurante Cerrado',
        '200 · isOpenNow false · closed',
        text,
        false,
      );
      return;
    }
    this.closed = true;
    try {
      const result = await this.reserve('diner2', this.config.partySize);
      this.row(
        'a1',
        'Reservar con el restaurante Cerrado',
        '409 · RESTAURANT_CLOSED',
        result,
        isError(result, 409, 'RESTAURANT_CLOSED'),
      );
      const detail = await this.api(
        'GET',
        `/v1/restaurants/${this.config.restaurantId}/public`,
        this.tokens.diner2,
      );
      this.row(
        'a2',
        'Detalle público con el restaurante Cerrado',
        '200 · isOpenNow false · closed',
        `${describe(detail)}${detail.json ? ` · isOpenNow ${detail.json.isOpenNow} · ${detail.json.availability}` : ''}`,
        detail.status === 200 &&
          detail.json?.isOpenNow === false &&
          detail.json?.availability === 'closed',
      );
    } finally {
      const reopened = await this.reopen();
      this.row(
        'a3',
        'El restaurante vuelve a Abierto',
        '200 · isOpen true',
        reopened ? 'HTTP 200 · isOpen true' : this.reopenDetail,
        reopened,
      );
    }
  }

  // Cancela todo lo que se creó. Devuelve las que no se pudieron cancelar.
  async cancelCreated() {
    const failed = [];
    for (const { id, token } of this.created) {
      const result = await this.api(
        'POST',
        `/v1/reservations/${id}/cancel`,
        token,
      );
      const resolved =
        (result.status === 200 && result.json?.status === 'cancelled') ||
        isError(result, 409, 'RESERVATION_NOT_ACTIVE');
      if (!resolved) {
        failed.push(`${id}: ${describe(result)}`);
      }
    }
    return failed;
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

function printReopenAlarm(detail) {
  const bar = '!'.repeat(72);
  console.error(`\n${bar}`);
  console.error('!!  EL RESTAURANTE QUEDÓ CERRADO: NO SE PUDO VOLVER A ABRIR');
  console.error(
    '!!  Ábrelo YA en la web (Abierto) o con PATCH /v1/restaurants/me/status { "isOpen": true }.',
  );
  console.error(`!!  Detalle: ${detail}`);
  console.error(`${bar}\n`);
}

async function main() {
  const config = readConfig();

  console.log(`BASE_URL:       ${config.origin}`);
  console.log(`RESTAURANT_ID:  ${config.restaurantId}`);
  console.log(
    `PARTY_SIZE:     ${config.partySize} (reservas normales) · ${LARGE_PARTY_SIZE} (variante b)`,
  );
  console.log(`Administrador:  ${config.adminEmail}`);
  console.log(`Comensales:     ${QA_DINER_1} (c), ${QA_DINER_2} (a y b)`);
  console.log(
    '\n⚠ Escribe en la base que use ese backend (en local, la de su DATABASE_URL): crea y cancela reservas, y CIERRA el restaurante unos segundos para la variante (a) y lo vuelve a abrir.',
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

  const run = new M1Run(config, api, tokens);
  // Ctrl+C con el restaurante cerrado: primero se vuelve a abrir.
  const onInterrupt = async () => {
    if (run.closed && !(await run.reopen())) {
      printReopenAlarm(run.reopenDetail);
    }
    process.exit(130);
  };
  process.once('SIGINT', onInterrupt);

  let failedCancels = [];
  let completed = false;
  try {
    await run.largeParty();
    await run.secondReservation();
    // Al final: el restaurante queda cerrado el menor tiempo posible.
    await run.closedRestaurant();
    completed = true;
  } finally {
    if (run.closed) {
      await run.reopen(); // segundo intento si el de closedRestaurant falló
    }
    failedCancels = await run.cancelCreated();
    process.removeListener('SIGINT', onInterrupt);
    // Con un error inesperado no se llega a la tabla: la alarma sale aquí.
    if (!completed && run.closed) {
      printReopenAlarm(
        run.reopenDetail ?? 'error inesperado durante la prueba',
      );
    }
  }

  console.log('');
  printTable(run.rows);
  if (failedCancels.length === 0) {
    console.log(
      `\nLimpieza: ${run.created.length} reserva(s) de prueba cancelada(s).`,
    );
  } else {
    console.log(
      `\nAviso: no se pudieron cancelar ${failedCancels.length} reserva(s); vencen solas en RESERVATION_TTL_MINUTES:`,
    );
    for (const line of failedCancels) {
      console.log(`  - ${line}`);
    }
  }
  if (run.reopenFailed && run.closed) {
    printReopenAlarm(run.reopenDetail);
  }

  const failed = run.rows.filter((row) => row.veredicto === 'FALLA').length;
  console.log(`\nM1: ${run.rows.length - failed} PASA · ${failed} FALLA.`);
  return failed === 0 && failedCancels.length === 0 && !run.closed ? 0 : 1;
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
