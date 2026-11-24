// QA del Sprint 3, caso T1, filas HTTP 1 a 6 (docs/qa/sprint3-jacobo.md): cada
// rol solo hace lo suyo. Contra el backend LOCAL, con cuentas reales de Firebase.
// Contratos: CLAUDE.md §10 (códigos de cuenta y 401), §12.8 y §12.9. Los guardas
// van antes que los pipes, así que el 403 de rol sale aunque el :id sea válido.
// Solo usa Node 24 y su fetch.
//
// Entradas (solo variables de entorno; nunca archivos ni valores por defecto
// de credenciales):
//   BASE_URL          backend sin /v1: solo http://localhost:<puerto> o http://127.0.0.1:<puerto>
//   RESTAURANT_ID     uuid del restaurante del administrador (donde reserva qa21)
//   PARTY_SIZE        personas de la reserva de prueba (1 a 20)
//   FIREBASE_API_KEY  llave web del proyecto de Firebase
//   QA_PASSWORD       clave de dinnoteam2026+qa21 y +qa22 (scripts/qa/crear-comensales.mjs)
//   ADMIN_EMAIL       correo del restaurant_admin de RESTAURANT_ID
//   ADMIN_PASSWORD    su clave
//   CONFIRM=1         envía; sin esto solo es un ensayo (no llama a nada)
//
// Crea UNA reserva (qa21) y la cancela al final. Nunca imprime ni guarda claves,
// tokens ni códigos de reserva: el código solo vive en memoria.

const QA_OWNER = 'dinnoteam2026+qa21@gmail.com'; // dueño de la reserva de prueba
const QA_OTHER = 'dinnoteam2026+qa22@gmail.com'; // otro comensal (fila 6)
const FIREBASE_SIGN_IN_URL =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 30_000;
// Un token con forma de JWT pero sin firma válida: Firebase lo rechaza (401).
const FAKE_TOKEN =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJxYS1mYWxzbyJ9.firma-falsa';

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
  if (!/^\d+$/.test(rawParty) || partySize < 1 || partySize > 20) {
    fail('PARTY_SIZE debe ser un entero entre 1 y 20.');
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

// «HTTP 403 · RESTAURANT_ACCOUNT». Nunca incluye el cuerpo (podría traer el código).
function describe(result) {
  if (result.status === null) {
    return result.error;
  }
  return `HTTP ${result.status}${result.json?.errorCode ? ` · ${result.json.errorCode}` : ''}`;
}

function isError(result, status, errorCode) {
  return (
    result.status === status &&
    (errorCode === null
      ? result.json?.errorCode === undefined
      : result.json?.errorCode === errorCode)
  );
}

async function signInAll(config) {
  const accounts = [
    ['admin', config.adminEmail, config.adminPassword],
    ['owner', QA_OWNER, config.qaPassword],
    ['other', QA_OTHER, config.qaPassword],
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

// Antes de crear nada: el backend responde, el admin es de RESTAURANT_ID y
// ninguno de los dos comensales tiene una reserva activa.
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
    ['owner', QA_OWNER],
    ['other', QA_OTHER],
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

class T1Run {
  constructor(api, tokens, reservation) {
    this.api = api;
    this.tokens = tokens;
    this.reservation = reservation; // la de qa21; su código solo vive aquí
    this.rows = [];
  }

  row(id, caso, esperado, result, pasa) {
    this.rows.push({
      id,
      caso,
      esperado,
      real: typeof result === 'string' ? result : describe(result),
      veredicto: pasa ? 'PASA' : 'FALLA',
    });
  }

  // La reserva de qa21 sigue activa, con su mismo código y sin check-in.
  async ownerReservationIntact() {
    const view = await this.api(
      'GET',
      `/v1/reservations/${this.reservation.id}`,
      this.tokens.owner,
    );
    const intact =
      view.status === 200 &&
      view.json?.status === 'active' &&
      view.json?.code === this.reservation.code &&
      view.json?.checkedInAt === null;
    return {
      intact,
      text: `${describe(view)}${view.json?.status ? ` · ${view.json.status}` : ''}`,
    };
  }

  // Filas 1 y 2: el restaurante en las rutas de comensal.
  async restaurantOnDinerRoutes(config) {
    const expected = '403 · RESTAURANT_ACCOUNT';
    const { id } = this.reservation;
    const calls = [
      [
        '1',
        'Restaurante: POST /v1/reservations',
        'POST',
        '/v1/reservations',
        { restaurantId: config.restaurantId, partySize: config.partySize },
      ],
      [
        '2a',
        'Restaurante: GET /v1/reservations/active',
        'GET',
        '/v1/reservations/active',
      ],
      [
        '2b',
        'Restaurante: GET /v1/reservations/:id',
        'GET',
        `/v1/reservations/${id}`,
      ],
      [
        '2c',
        'Restaurante: POST /v1/reservations/:id/cancel',
        'POST',
        `/v1/reservations/${id}/cancel`,
      ],
    ];
    for (const [rowId, caso, method, path, body] of calls) {
      const result = await this.api(method, path, this.tokens.admin, body);
      this.row(
        rowId,
        caso,
        expected,
        result,
        isError(result, 403, 'RESTAURANT_ACCOUNT'),
      );
    }
    const after = await this.ownerReservationIntact();
    this.row(
      '2d',
      'La reserva de qa21 sigue activa tras 1 a 2c',
      '200 · active, mismo código, sin check-in',
      after.text,
      after.intact,
    );
  }

  // Filas 3 y 4: el comensal en las rutas de restaurante.
  async dinerOnRestaurantRoutes() {
    const expected = '403 · DINER_ACCOUNT';
    const checkIn = await this.api(
      'POST',
      '/v1/restaurants/me/check-ins',
      this.tokens.owner,
      { code: this.reservation.code },
    );
    this.row(
      '3a',
      'Comensal: POST /v1/restaurants/me/check-ins (con su propio código)',
      expected,
      checkIn,
      isError(checkIn, 403, 'DINER_ACCOUNT'),
    );
    const after = await this.ownerReservationIntact();
    this.row(
      '3b',
      'El check-in del comensal no cambió la reserva',
      '200 · active, mismo código, sin check-in',
      after.text,
      after.intact,
    );
    const list = await this.api(
      'GET',
      '/v1/restaurants/me/reservations',
      this.tokens.owner,
    );
    this.row(
      '4',
      'Comensal: GET /v1/restaurants/me/reservations',
      expected,
      list,
      isError(list, 403, 'DINER_ACCOUNT'),
    );
  }

  // Fila 5: sin token y con un token falso, una ruta de cada rol.
  async withoutSession() {
    const routes = [
      ['de comensal', 'GET', '/v1/reservations/active'],
      ['de restaurante', 'GET', '/v1/restaurants/me/reservations'],
    ];
    const tokens = [
      ['sin token', undefined],
      ['token falso', FAKE_TOKEN],
    ];
    let letter = 0;
    for (const [routeName, method, path] of routes) {
      for (const [tokenName, token] of tokens) {
        const result = await this.api(method, path, token);
        this.row(
          `5${'abcd'[letter]}`,
          `${tokenName}, ruta ${routeName} (${method} ${path})`,
          '401 sin errorCode',
          result,
          isError(result, 401, null),
        );
        letter += 1;
      }
    }
  }

  // Fila 6: qa22 intenta ver y cancelar la reserva de qa21.
  async otherDinersReservation() {
    const expected = '404 · RESERVATION_NOT_FOUND';
    const { id } = this.reservation;
    const view = await this.api(
      'GET',
      `/v1/reservations/${id}`,
      this.tokens.other,
    );
    this.row(
      '6a',
      'qa22 ve la reserva de qa21',
      expected,
      view,
      isError(view, 404, 'RESERVATION_NOT_FOUND'),
    );
    const cancel = await this.api(
      'POST',
      `/v1/reservations/${id}/cancel`,
      this.tokens.other,
    );
    this.row(
      '6b',
      'qa22 cancela la reserva de qa21',
      expected,
      cancel,
      isError(cancel, 404, 'RESERVATION_NOT_FOUND'),
    );
    const after = await this.ownerReservationIntact();
    this.row(
      '6c',
      'La reserva de qa21 sigue activa tras 6a y 6b',
      '200 · active, mismo código, sin check-in',
      after.text,
      after.intact,
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

  console.log(`BASE_URL:       ${config.origin}`);
  console.log(`RESTAURANT_ID:  ${config.restaurantId}`);
  console.log(`PARTY_SIZE:     ${config.partySize}`);
  console.log(`Administrador:  ${config.adminEmail}`);
  console.log(`Comensales:     ${QA_OWNER} (dueño), ${QA_OTHER} (otro)`);
  console.log(
    '\n⚠ Escribe en la base que use ese backend (en local, la de su DATABASE_URL): crea una reserva de qa21 y la cancela al final.',
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

  const created = await api('POST', '/v1/reservations', tokens.owner, {
    restaurantId: config.restaurantId,
    partySize: config.partySize,
  });
  if (created.status !== 201 || typeof created.json?.code !== 'string') {
    console.error(
      `No se pudo crear la reserva de prueba de ${QA_OWNER} (${describe(created)}). No se creó nada.`,
    );
    return 2;
  }

  const run = new T1Run(api, tokens, created.json);
  await run.restaurantOnDinerRoutes(config);
  await run.dinerOnRestaurantRoutes();
  await run.withoutSession();
  await run.otherDinersReservation();

  // Limpieza: qa21 cancela su reserva de prueba.
  const cancel = await api(
    'POST',
    `/v1/reservations/${created.json.id}/cancel`,
    tokens.owner,
  );
  const cleaned = cancel.status === 200 && cancel.json?.status === 'cancelled';
  // 409: alguna fila (un fallo) ya la sacó de active; no queda nada que vencer.
  const alreadyResolved = isError(cancel, 409, 'RESERVATION_NOT_ACTIVE');

  console.log('');
  printTable(run.rows);
  if (cleaned) {
    console.log('\nLimpieza: la reserva de prueba de qa21 quedó cancelada.');
  } else if (alreadyResolved) {
    console.log(
      '\nAviso: la reserva de prueba de qa21 ya no estaba activa (la cambió una fila que falló); revisa su mesa en la web.',
    );
  } else {
    console.log(
      `\nAviso: no se pudo cancelar la reserva de prueba de qa21 (${describe(cancel)}); si sigue activa, vence sola en RESERVATION_TTL_MINUTES.`,
    );
  }

  const failed = run.rows.filter((row) => row.veredicto === 'FALLA').length;
  console.log(
    `\nT1 (HTTP): ${run.rows.length - failed} PASA · ${failed} FALLA.`,
  );
  return failed === 0 && cleaned ? 0 : 1;
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
