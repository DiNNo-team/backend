// QA del Sprint 3 (casos M2 y M3, docs/qa/sprint3-jacobo.md): lanza N
// POST /v1/reservations al mismo tiempo, cada uno con el token de un comensal
// distinto, contra un restaurante, y comprueba la regla de CLAUDE.md §12.4:
// exactamente tantas reservas como mesas disponibles, y las demás
// 409 NO_TABLE_AVAILABLE. Solo usa Node 24 y su fetch.
//
// Entradas (solo variables de entorno; nunca archivos ni valores por defecto
// de credenciales):
//   BASE_URL         URL del backend sin /v1 (http://localhost:3000 o https://<servicio>.onrender.com)
//   RESTAURANT_ID    uuid del restaurante de pruebas
//   PARTY_SIZE       personas por reserva (1 a 20)
//   EXPECTED_TABLES  mesas activas, Disponibles y con capacidad >= PARTY_SIZE justo antes de correr
//   TOKEN_1..TOKEN_N tokens de Firebase de N comensales distintos (N >= 2, consecutivos)
//   o, si no hay ningún TOKEN_N, inicio de sesión dentro del proceso:
//     FIREBASE_API_KEY llave web del proyecto de Firebase
//     QA_PASSWORD      clave de las cuentas dinnoteam2026+qa21…qa25 (scripts/qa/crear-comensales.mjs)
//     QA_DINERS        cuántas cuentas usar, de 2 a 5 (desde +qa21)
//   ALLOW_HOST      solo si BASE_URL no es localhost: el host de Render exacto (*.onrender.com)
//   CONFIRM=1        envía las solicitudes; sin esto solo es un ensayo (no envía nada)
//   CLEANUP=1        al final cancela cada reserva creada
//
// Los tokens, la llave y la clave nunca se imprimen, ni se guardan, ni se
// incluyen en los errores. Tampoco se imprime el código de check-in.

const RESERVATION_PATH = '/v1/reservations';
const QA_ALIASES = [21, 22, 23, 24, 25].map(
  (n) => `dinnoteam2026+qa${n}@gmail.com`,
);
const FIREBASE_SIGN_IN_URL =
  'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const SIGN_IN_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 120_000; // Render gratuito puede tardar ~1 min en despertar.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ConfigError extends Error {}

function fail(message) {
  throw new ConfigError(message);
}

function readInteger(name, min, max) {
  const raw = process.env[name];
  if (raw === undefined || !/^\d+$/.test(raw.trim())) {
    fail(`${name} es obligatoria y debe ser un entero.`);
  }
  const value = Number(raw.trim());
  if (value < min || value > max) {
    fail(`${name} debe estar entre ${min} y ${max}.`);
  }
  return value;
}

// TOKEN_N si existe alguno (como siempre); si no, las cuentas QA con inicio de
// sesión. Los tokens del inicio de sesión se piden después del ensayo.
function readIdentities() {
  if (process.env.TOKEN_1 !== undefined) {
    const tokens = readTokens();
    return {
      source: 'tokens',
      tokens,
      labels: tokens.map((_, i) => `comensal ${i + 1}`),
    };
  }
  const apiKey = process.env.FIREBASE_API_KEY;
  const password = process.env.QA_PASSWORD;
  if (!apiKey || !password) {
    fail(
      'Faltan los comensales: define TOKEN_1…TOKEN_N, o FIREBASE_API_KEY, QA_PASSWORD y QA_DINERS.',
    );
  }
  const count = readInteger('QA_DINERS', 2, QA_ALIASES.length);
  const emails = QA_ALIASES.slice(0, count);
  return {
    source: 'signin',
    apiKey,
    password,
    emails,
    tokens: null,
    labels: emails,
  };
}

// Firebase responde { error: { message: "CODIGO : detalle" } }: solo el código.
function firebaseErrorCode(json) {
  const message = json?.error?.message;
  return typeof message === 'string'
    ? message.split(/[\s:]/)[0]
    : 'ERROR_DESCONOCIDO';
}

// Una cuenta a la vez (Firebase limita los intentos seguidos). Si una falla, no
// se envía ninguna reserva. La URL lleva la llave: nunca sale en un mensaje.
async function signInQaDiners(identities) {
  const tokens = [];
  for (const email of identities.emails) {
    let result;
    try {
      const response = await fetch(
        `${FIREBASE_SIGN_IN_URL}?${new URLSearchParams({ key: identities.apiKey })}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            password: identities.password,
            returnSecureToken: true,
          }),
          signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
        },
      );
      const json = await response.json().catch(() => null);
      result =
        response.ok && typeof json?.idToken === 'string'
          ? { token: json.idToken }
          : { error: firebaseErrorCode(json) };
    } catch (error) {
      result = { error: describeNetworkError(error) };
    }
    if (result.error) {
      console.error(
        `No se pudo iniciar sesión con ${email} (${result.error}); no se envió ninguna reserva.`,
      );
      return null;
    }
    tokens.push(result.token);
  }
  console.log(`Sesión iniciada: ${tokens.length} comensales QA.`);
  return tokens;
}

function readTokens() {
  const tokens = [];
  for (let i = 1; process.env[`TOKEN_${i}`] !== undefined; i += 1) {
    const token = process.env[`TOKEN_${i}`].trim();
    if (token === '') {
      fail(`TOKEN_${i} está vacía.`);
    }
    tokens.push(token);
  }
  if (tokens.length < 2) {
    fail('Hacen falta al menos TOKEN_1 y TOKEN_2 (comensales distintos).');
  }
  if (new Set(tokens).size !== tokens.length) {
    fail(
      'Hay tokens repetidos: cada solicitud debe ser de un comensal distinto.',
    );
  }
  return tokens;
}

// localhost siempre; otro host solo si es exactamente ALLOW_HOST y es de Render.
function readBaseUrl() {
  const raw = process.env.BASE_URL;
  if (!raw) {
    fail('BASE_URL es obligatoria (sin /v1).');
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
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
  if (LOCAL_HOSTS.has(url.hostname)) {
    return { origin: url.origin, isLocal: true };
  }
  const allowHost = process.env.ALLOW_HOST?.trim().toLowerCase();
  if (!allowHost) {
    fail(
      `El host ${url.hostname} no es localhost. Para usarlo, define ALLOW_HOST con ese host exacto.`,
    );
  }
  if (!allowHost.endsWith('.onrender.com')) {
    fail('ALLOW_HOST solo acepta un dominio de Render (*.onrender.com).');
  }
  if (url.hostname !== allowHost) {
    fail(
      `El host de BASE_URL (${url.hostname}) no es ALLOW_HOST (${allowHost}).`,
    );
  }
  if (url.protocol !== 'https:') {
    fail('Contra Render, BASE_URL debe usar https.');
  }
  return { origin: url.origin, isLocal: false };
}

function readConfig() {
  const { origin, isLocal } = readBaseUrl();
  const restaurantId = process.env.RESTAURANT_ID?.trim();
  if (!restaurantId || !UUID_PATTERN.test(restaurantId)) {
    fail('RESTAURANT_ID es obligatoria y debe ser un uuid.');
  }
  const partySize = readInteger('PARTY_SIZE', 1, 20);
  const identities = readIdentities();
  const expectedTables = readInteger(
    'EXPECTED_TABLES',
    1,
    identities.labels.length,
  );
  return {
    origin,
    isLocal,
    restaurantId,
    partySize,
    identities,
    // Los tokens del inicio de sesión se llenan después del ensayo (main).
    tokens: identities.tokens,
    labels: identities.labels,
    expectedTables,
    confirm: process.env.CONFIRM === '1',
    cleanup: process.env.CLEANUP === '1',
  };
}

// Describe un fallo de red sin el mensaje completo: nunca incluye cabeceras.
function describeNetworkError(error) {
  if (error?.name === 'TimeoutError') {
    return 'tiempo de espera agotado';
  }
  const cause = error?.cause?.code;
  return cause
    ? `error de red (${cause})`
    : `error de red (${error?.name ?? 'desconocido'})`;
}

async function callApi(origin, path, token, body) {
  try {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch (error) {
    return { status: null, networkError: describeNetworkError(error) };
  }
}

async function warmUp(origin) {
  try {
    const response = await fetch(`${origin}/v1/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await response.json();
    console.log(
      `Health: ${response.status} · commit ${json?.commit ?? 'null'}`,
    );
    return response.ok;
  } catch (error) {
    console.error(`Health no respondió: ${describeNetworkError(error)}.`);
    return false;
  }
}

function summarize(results, config) {
  const created = [];
  let noTable = 0;
  const others = [];
  results.forEach((result, index) => {
    const who = config.labels[index];
    if (result.status === 201) {
      created.push({ who, index, reservation: result.json });
    } else if (
      result.status === 409 &&
      result.json?.errorCode === 'NO_TABLE_AVAILABLE'
    ) {
      noTable += 1;
    } else if (result.status === null) {
      others.push(`${who}: ${result.networkError}`);
    } else {
      others.push(
        `${who}: HTTP ${result.status} · errorCode ${result.json?.errorCode ?? '—'} · ${JSON.stringify(result.json?.message ?? '')}`,
      );
    }
  });

  const problems = [];
  if (created.length !== config.expectedTables) {
    problems.push(
      `se crearon ${created.length} reservas y se esperaban ${config.expectedTables} (EXPECTED_TABLES)`,
    );
  }
  if (others.length > 0) {
    problems.push(
      `respuestas que no fueron 201 ni 409 NO_TABLE_AVAILABLE: ${others.length}`,
    );
  }

  // M3: cada reserva en una mesa distinta (el identificador es único por restaurante).
  const tablesSeen = new Map();
  for (const { who, reservation } of created) {
    const identifier = reservation?.table?.identifier;
    if (typeof identifier !== 'string') {
      problems.push(`${who}: la respuesta 201 no trae table.identifier`);
      continue;
    }
    const key = identifier.trim().toLowerCase();
    if (tablesSeen.has(key)) {
      problems.push(
        `${who} y ${tablesSeen.get(key)} recibieron la misma mesa (${identifier})`,
      );
    } else {
      tablesSeen.set(key, who);
    }
    if (reservation?.restaurant?.id !== config.restaurantId) {
      problems.push(`${who}: la reserva es de otro restaurante`);
    }
    if (reservation?.status !== 'active') {
      problems.push(
        `${who}: la reserva no está active (${reservation?.status})`,
      );
    }
  }

  return { created, noTable, others, problems };
}

async function cancelCreated(created, config) {
  console.log('\nLimpieza (CLEANUP=1): cancelando las reservas creadas…');
  const outcomes = await Promise.all(
    created.map(async ({ who, index, reservation }) => {
      const result = await callApi(
        config.origin,
        `${RESERVATION_PATH}/${encodeURIComponent(reservation.id)}/cancel`,
        config.tokens[index],
      );
      if (result.status === 200 && result.json?.status === 'cancelled') {
        return null;
      }
      const detail =
        result.status === null
          ? result.networkError
          : `HTTP ${result.status} · errorCode ${result.json?.errorCode ?? '—'}`;
      return `${who} (reserva ${reservation.id}): ${detail}`;
    }),
  );
  const failed = outcomes.filter(Boolean);
  if (failed.length === 0) {
    console.log(`Canceladas: ${created.length} de ${created.length}.`);
    return;
  }
  console.log(`No se pudieron cancelar ${failed.length}:`);
  for (const line of failed) {
    console.log(`  - ${line}`);
  }
  console.log(
    'Revisa cada una con GET /v1/reservations/:id; si alguna sigue activa, vence sola en RESERVATION_TTL_MINUTES.',
  );
}

async function main() {
  const config = readConfig();

  console.log(`BASE_URL:        ${config.origin}`);
  console.log(`RESTAURANT_ID:   ${config.restaurantId}`);
  console.log(`PARTY_SIZE:      ${config.partySize}`);
  console.log(`EXPECTED_TABLES: ${config.expectedTables}`);
  console.log(`Solicitudes:     ${config.labels.length} (una por comensal)`);
  console.log(
    `Comensales:      ${
      config.identities.source === 'tokens'
        ? 'TOKEN_1…TOKEN_N'
        : `inicio de sesión con ${config.labels.join(', ')}`
    }`,
  );
  console.log(`Limpieza:        ${config.cleanup ? 'sí (CLEANUP=1)' : 'no'}`);
  console.log(
    '\n⚠ Escribe en la base que use ese backend (en local, la de su DATABASE_URL): crea reservas, cambia mesas y deja filas en la bitácora.',
  );
  if (config.isLocal) {
    console.log(
      '  En local, el backend debe correr con DEV_USER_ENABLED=false: con el usuario de desarrollo ignora los tokens y todas las solicitudes serían del mismo usuario.',
    );
  }

  if (!config.confirm) {
    console.log(
      '\nEnsayo: no se envió nada. Para enviar, repite con CONFIRM=1.',
    );
    return 0;
  }

  if (!(await warmUp(config.origin))) {
    console.error('El backend no está listo; no se envió ninguna reserva.');
    return 2;
  }

  if (config.identities.source === 'signin') {
    config.tokens = await signInQaDiners(config.identities);
    if (config.tokens === null) {
      return 2;
    }
  }

  const body = {
    restaurantId: config.restaurantId,
    partySize: config.partySize,
  };
  // Todas las solicitudes se crean en el mismo tick, antes de esperar ninguna.
  const startedAt = Date.now();
  const results = await Promise.all(
    config.tokens.map((token) =>
      callApi(config.origin, RESERVATION_PATH, token, body),
    ),
  );
  const elapsedMs = Date.now() - startedAt;

  const { created, noTable, others, problems } = summarize(results, config);

  console.log(`\nResultado (${elapsedMs} ms):`);
  console.log(`  201 creadas:                 ${created.length}`);
  for (const { who, reservation } of created) {
    console.log(
      `    - ${who}: reserva ${reservation?.id} · Mesa ${reservation?.table?.identifier} (capacidad ${reservation?.table?.capacity})`,
    );
  }
  console.log(`  409 NO_TABLE_AVAILABLE:      ${noTable}`);
  console.log(`  Otras:                       ${others.length}`);
  for (const line of others) {
    console.log(`    - ${line}`);
  }

  if (problems.length === 0) {
    console.log('\nVeredicto: PASA');
  } else {
    console.log('\nVeredicto: FALLA');
    for (const problem of problems) {
      console.log(`  - ${problem}`);
    }
  }

  if (config.cleanup && created.length > 0) {
    await cancelCreated(created, config);
  }

  return problems.length === 0 ? 0 : 1;
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
