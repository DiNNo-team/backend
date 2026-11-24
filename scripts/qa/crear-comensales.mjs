// QA del Sprint 3: crea los comensales de prueba dinnoteam2026+qa21 … +qa25
// (@gmail.com) sin la app móvil, con la API REST de Firebase Authentication
// (Identity Toolkit) y POST /v1/diners/me (CLAUDE.md §10). Solo Node 24 y su fetch.
//
// Dos modos:
//   (por defecto) crear: accounts:signUp (si ya existe, inicia sesión) y
//                 accounts:sendOobCode VERIFY_EMAIL. Después hay que abrir el
//                 enlace de cada correo (llegan a la bandeja de dinnoteam2026).
//   VERIFY=1      verificar: accounts:signInWithPassword, accounts:lookup
//                 (emailVerified) y, si está verificado, POST /v1/diners/me.
//
// Entradas (solo variables de entorno, sin valores por defecto):
//   FIREBASE_API_KEY  llave web del proyecto de Firebase
//   QA_PASSWORD       clave de las cuentas de esta corrida (mínimo 6 caracteres)
//   BASE_URL          backend local sin /v1 (solo localhost o 127.0.0.1); obligatoria con VERIFY=1
//   ALIASES           opcional, separados por comas: 21 a 26 y qaadmin (por defecto 21,22,23,24,25)
//   CONFIRM=1         envía de verdad; sin esto es un ensayo y no llama a nada
//
// Dos cuentas para las que NUNCA se llama POST /v1/diners/me (con VERIFY=1 solo
// se comprueba que el correo esté verificado):
//   qa26     comensal «sin perfil local» (T1, fila 12).
//   qaadmin  administrador sin restaurante (T1, fila 10): se habilita a mano con
//            un INSERT en users (docs/database.md); si se llamara /v1/diners/me
//            antes, quedaría como comensal.
//
// La llave, la clave y los tokens nunca se imprimen, ni se guardan, ni se
// incluyen en los errores: de Firebase solo se muestra el código de error.

const DEFAULT_ALIASES = ['21', '22', '23', '24', '25'];
const ALLOWED_ALIASES = new Set([...DEFAULT_ALIASES, '26', 'qaadmin']);
const aliasEmail = (alias) =>
  `dinnoteam2026+${/^\d+$/.test(alias) ? `qa${alias}` : alias}@gmail.com`;
// Cuentas sin POST /v1/diners/me, con lo que muestra la tabla.
const NO_PROFILE_CALL = new Map([
  [aliasEmail('26'), 'sin perfil (a propósito, no se llama)'],
  [
    aliasEmail('qaadmin'),
    'administrador: no se llama (se habilita con INSERT)',
  ],
]);
const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const REQUEST_TIMEOUT_MS = 30_000;

class ConfigError extends Error {}

function fail(message) {
  throw new ConfigError(message);
}

function readSecret(name, minLength) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    fail(`${name} es obligatoria.`);
  }
  if (value.length < minLength) {
    fail(`${name} debe tener al menos ${minLength} caracteres.`);
  }
  return value;
}

function readBaseUrl() {
  const raw = process.env.BASE_URL;
  if (!raw) {
    fail('BASE_URL es obligatoria con VERIFY=1 (sin /v1).');
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
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    fail(
      `El host ${url.hostname} no está permitido: solo localhost o 127.0.0.1.`,
    );
  }
  return url.origin;
}

function readAliases() {
  const raw = process.env.ALIASES;
  if (raw === undefined) {
    return DEFAULT_ALIASES.map(aliasEmail);
  }
  const parts = raw.split(',').map((part) => part.trim().toLowerCase());
  if (parts.some((part) => !ALLOWED_ALIASES.has(part))) {
    fail(
      'ALIASES solo acepta 21 a 26 y qaadmin, separados por comas, como «26» o «qaadmin».',
    );
  }
  return [...new Set(parts)].map(aliasEmail);
}

function readConfig() {
  const verify = process.env.VERIFY === '1';
  return {
    verify,
    aliases: readAliases(),
    apiKey: readSecret('FIREBASE_API_KEY', 1),
    password: readSecret('QA_PASSWORD', 6),
    origin: verify ? readBaseUrl() : null,
    confirm: process.env.CONFIRM === '1',
  };
}

// Sin el mensaje completo de fetch: nunca incluye la URL (que lleva la llave).
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

async function firebase(apiKey, method, body) {
  const url = `${IDENTITY_TOOLKIT}/accounts:${method}?${new URLSearchParams({ key: apiKey })}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await response.json().catch(() => null);
    return response.ok
      ? { ok: true, json }
      : { ok: false, code: firebaseErrorCode(json) };
  } catch (error) {
    return { ok: false, code: networkError(error) };
  }
}

function signIn(config, email) {
  return firebase(config.apiKey, 'signInWithPassword', {
    email,
    password: config.password,
    returnSecureToken: true,
  });
}

async function isEmailVerified(config, idToken) {
  const result = await firebase(config.apiKey, 'lookup', { idToken });
  if (!result.ok) {
    return { ok: false, code: result.code };
  }
  return {
    ok: true,
    verified: result.json?.users?.[0]?.emailVerified === true,
  };
}

// Modo crear: signUp (o signIn si ya existe) y correo de verificación.
async function createOne(config, email) {
  const row = { email, cuenta: '', correo: '', verificado: '', perfil: '—' };

  let session = await firebase(config.apiKey, 'signUp', {
    email,
    password: config.password,
    returnSecureToken: true,
  });
  if (session.ok) {
    row.cuenta = 'creada';
  } else if (session.code === 'EMAIL_EXISTS') {
    session = await signIn(config, email);
    if (!session.ok) {
      row.cuenta = `ya existía; no se pudo iniciar sesión (${session.code})`;
      return row;
    }
    row.cuenta = 'ya existía';
  } else {
    row.cuenta = `error (${session.code})`;
    return row;
  }

  const idToken = session.json?.idToken;
  const status = await isEmailVerified(config, idToken);
  if (status.ok && status.verified) {
    row.verificado = 'sí';
    row.correo = 'no hace falta';
    return row;
  }
  row.verificado = status.ok ? 'no' : `? (${status.code})`;

  const sent = await firebase(config.apiKey, 'sendOobCode', {
    requestType: 'VERIFY_EMAIL',
    idToken,
  });
  row.correo = sent.ok ? 'enviado' : `error (${sent.code})`;
  return row;
}

async function createDinerProfile(origin, idToken) {
  try {
    const response = await fetch(`${origin}/v1/diners/me`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${idToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await response.json().catch(() => null);
    if (response.status === 201) {
      return { ok: true, text: `creado (201, rol ${json?.role})` };
    }
    if (response.status === 200) {
      return { ok: true, text: `ya existía (200, rol ${json?.role})` };
    }
    return {
      ok: false,
      text: `HTTP ${response.status} · errorCode ${json?.errorCode ?? '—'}`,
    };
  } catch (error) {
    return { ok: false, text: networkError(error) };
  }
}

// Modo verificar: signIn, emailVerified y POST /v1/diners/me.
async function verifyOne(config, email) {
  const row = { email, cuenta: '', correo: '—', verificado: '', perfil: '—' };

  const session = await signIn(config, email);
  if (!session.ok) {
    row.cuenta = `no se pudo iniciar sesión (${session.code})`;
    return row;
  }
  row.cuenta = 'existe';

  // signInWithPassword no trae emailVerified: se consulta con lookup. El token
  // recién emitido ya lleva email_verified, que es lo que revisa el backend.
  const idToken = session.json?.idToken;
  const status = await isEmailVerified(config, idToken);
  if (!status.ok) {
    row.verificado = `? (${status.code})`;
    return row;
  }
  if (!status.verified) {
    row.verificado = 'no: abre el enlace del correo';
    return row;
  }
  row.verificado = 'sí';

  // qa26 y qaadmin nunca pasan por /v1/diners/me.
  if (NO_PROFILE_CALL.has(email)) {
    row.perfil = NO_PROFILE_CALL.get(email);
    return row;
  }

  const profile = await createDinerProfile(config.origin, idToken);
  row.perfil = profile.ok ? profile.text : `error (${profile.text})`;
  return row;
}

function printTable(rows) {
  const headers = {
    email: 'Alias',
    cuenta: 'Cuenta Firebase',
    correo: 'Correo de verificación',
    verificado: 'Verificado',
    perfil: 'Perfil DiNNo (/v1/diners/me)',
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

function isFailure(row, verify) {
  if (verify) {
    return row.verificado !== 'sí' || row.perfil.startsWith('error');
  }
  return (
    row.cuenta.includes('error') ||
    row.cuenta.includes('no se pudo') ||
    row.correo.startsWith('error')
  );
}

async function main() {
  const config = readConfig();
  const mode = config.verify
    ? 'verificar (signInWithPassword + emailVerified + POST /v1/diners/me)'
    : 'crear (signUp + correo de verificación)';

  console.log(`Modo:     ${mode}`);
  console.log(`Alias:    ${config.aliases.join(', ')}`);
  if (config.verify) {
    for (const email of config.aliases.filter((a) => NO_PROFILE_CALL.has(a))) {
      console.log(
        `          ${email}: solo se comprueba el correo; NUNCA se llama POST /v1/diners/me.`,
      );
    }
  }
  if (config.verify) {
    console.log(`BASE_URL: ${config.origin}`);
  }
  console.log(
    '\n⚠ Usa el proyecto REAL de Firebase del equipo: crea cuentas que quedan ahí y envía correos a la bandeja de dinnoteam2026.',
  );

  if (!config.confirm) {
    console.log(
      '\nEnsayo: no se llamó a Firebase ni al backend. Para enviar, repite con CONFIRM=1.',
    );
    return 0;
  }

  // Una cuenta a la vez: Firebase limita los intentos seguidos (TOO_MANY_ATTEMPTS_TRY_LATER).
  const rows = [];
  for (const email of config.aliases) {
    rows.push(
      config.verify
        ? await verifyOne(config, email)
        : await createOne(config, email),
    );
  }

  console.log('');
  printTable(rows);

  if (!config.verify) {
    console.log(
      '\nAbre el enlace de verificación de cada correo enviado (bandeja de dinnoteam2026@gmail.com) y luego corre de nuevo con VERIFY=1 y BASE_URL.',
    );
  }

  const failures = rows.filter((row) => isFailure(row, config.verify)).length;
  console.log(
    failures === 0
      ? '\nTodo listo.'
      : `\nAlias con algo pendiente o con error: ${failures} de ${rows.length}.`,
  );
  return failures === 0 ? 0 : 1;
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
