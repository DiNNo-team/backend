// QA Sprint 3 · Azure 3.1.5 "Probar cancelación de reserva" (casos M5 y M6).
// Contrato: CLAUDE.md §12 / DiNNo_Sprint3_Reparto.md §2.1, 3.1, 3.2, 3.4 y 4.
// Uso, variables de entorno y banderas: scripts/qa-cancel-reservation.md.
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    'confirm-shared-db': { type: 'boolean', default: false },
    'include-expired': { type: 'boolean', default: false },
    'force-threshold': { type: 'boolean', default: false },
    only: { type: 'string' },
  },
});

function die(message) {
  console.error(message);
  process.exit(2);
}

const BASE_URL = (
  values.url ??
  process.env.DINNO_BASE_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');
const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL);

// Local y Render usan la misma base de Neon (CLAUDE.md, AVISOS.md): las dos
// escriben ahí, así que las dos piden la misma confirmación explícita.
if (!values['confirm-shared-db']) {
  die(
    `Este script crea y cancela reservas en Neon (local y Render usan la misma base). Pasa --confirm-shared-db si de verdad quieres correrlo contra ${BASE_URL}.`,
  );
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) die(`Falta la variable de entorno ${name}.`);
  return value;
}

// Local: cabecera x-dev-user-id (usuario de desarrollo, DEV_USER_ENABLED).
// Render: token de Firebase por variable de entorno. Nunca se imprime ninguno.
function actorHeaders(prefix, { required = false } = {}) {
  if (IS_LOCAL) {
    const id = process.env[`DINNO_DEV_${prefix}_ID`];
    if (!id && required) die(`Falta DINNO_DEV_${prefix}_ID (local).`);
    return id ? { 'x-dev-user-id': id } : null;
  }
  const token = process.env[`DINNO_${prefix}_TOKEN`];
  if (!token && required) die(`Falta DINNO_${prefix}_TOKEN (Render).`);
  return token ? { Authorization: `Bearer ${token}` } : null;
}

const RESTAURANT_ID = requireEnv('DINNO_RESTAURANT_ID');
const admin = actorHeaders('ADMIN', { required: true });
const dinerA = actorHeaders('DINER_A', { required: true });
const dinerBHeaders = actorHeaders('DINER_B');
const dinerB = dinerBHeaders ? { headers: dinerBHeaders } : null;
const adminActor = { headers: admin };
const dinerAActor = { headers: dinerA };

async function api(method, path, { actor, body } = {}) {
  const res = await fetch(`${BASE_URL}/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...actor?.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createReservation = (actor, partySize = 2) =>
  api('POST', '/reservations', {
    actor,
    body: { restaurantId: RESTAURANT_ID, partySize },
  });
const cancelReservation = (actor, id) =>
  api('POST', `/reservations/${id}/cancel`, { actor });
const getReservation = (actor, id) =>
  api('GET', `/reservations/${id}`, { actor });
const getActive = (actor) => api('GET', '/reservations/active', { actor });
const getTables = () => api('GET', '/tables', { actor: adminActor });
const setTableStatus = (tableId, status) =>
  api('PATCH', `/tables/${tableId}/status`, {
    actor: adminActor,
    body: { status },
  });
const getTableLogs = (tableId) =>
  api('GET', `/table-logs?tableId=${tableId}`, { actor: adminActor });
const getStatus = () =>
  api('GET', '/restaurants/me/status', { actor: adminActor });
const setOpen = (isOpen) =>
  api('PATCH', '/restaurants/me/status', {
    actor: adminActor,
    body: { isOpen },
  });
const getPublic = (actor) =>
  api('GET', `/restaurants/${RESTAURANT_ID}/public`, { actor });
const search = (actor, lat, lng) =>
  api('GET', `/search/restaurants?lat=${lat}&lng=${lng}&radiusKm=10`, {
    actor,
  });
const getOwnRestaurant = () =>
  api('GET', '/restaurants/me', { actor: adminActor });

// El restaurante siempre sale de DINNO_RESTAURANT_ID; esto solo evita correr
// por error contra un restaurante distinto al que da DINNO_DEV_ADMIN_ID /
// DINNO_ADMIN_TOKEN (nada en el script asume cuál es: ni nombre, ni mesas).
async function assertAdminMatchesRestaurant() {
  const { status, body } = await getOwnRestaurant();
  if (status !== 200) {
    die(
      `No pude confirmar el restaurante del admin (${status}): ${body?.message ?? ''}`,
    );
  }
  if (body.id !== RESTAURANT_ID) {
    die(
      `DINNO_RESTAURANT_ID (${RESTAURANT_ID}) no es el restaurante de la cuenta admin (${body.id}, "${body.name}"). Revisa las variables antes de correr nada.`,
    );
  }
  return body;
}

// Misma fórmula confirmada en el backend (matriz del Sprint 2): >30% libre es
// "available", si no y hay al menos 1 libre es "few", 0 libres es "none".
function expectedAvailabilityLevel(tables) {
  const active = tables.filter((t) => t.isActive);
  const free = active.filter((t) => t.status === 'available');
  if (free.length === 0) return 'none';
  return free.length * 10 > active.length * 3 ? 'available' : 'few';
}

async function freeActiveReservation(actor) {
  const { body } = await getActive(actor);
  if (body?.reservation?.status === 'active') {
    await cancelReservation(actor, body.reservation.id);
  }
}

// ===== Seguimiento para el resumen de limpieza final =====
const createdReservations = []; // { id, variant }
const touchedTables = []; // { tableId, identifier, before }
let restaurantInitialOpen = null; // capturado en main(); comparado en printCleanupSummary

function trackReservation(variant, id) {
  createdReservations.push({ id, variant });
}

// Ocupa (vía la API) las demás mesas libres y activas para que el nivel de
// disponibilidad quede en el borde del umbral. Devuelve cómo revertirlas.
// Solo se llama con --force-threshold (en local y en Render por igual): no
// asume Casa 72 ni ningún restaurante en particular, calcula con las mesas
// reales de DINNO_RESTAURANT_ID.
async function occupyOtherFreeTables(excludeTableId) {
  const { body: tables } = await getTables();
  const toOccupy = tables.filter(
    (t) => t.id !== excludeTableId && t.isActive && t.status === 'available',
  );
  for (const table of toOccupy) {
    await setTableStatus(table.id, 'occupied');
    touchedTables.push({
      tableId: table.id,
      identifier: table.identifier,
      before: table.status,
    });
  }
  return async () => {
    for (const table of toOccupy) await setTableStatus(table.id, 'available');
  };
}

const LABELS = {
  'M5.1': 'Cancelar una reserva activa propia',
  'M5.2': 'Cancelar dos veces la misma',
  'M5.3': 'Cancelar una reserva vencida',
  'M5.4': 'Comensal B cancela la reserva de A',
  'M6.1': 'Mesa liberada',
  'M6.2': 'Disponibilidad pública',
  'M6.3': 'Bitácora',
  'M6.4': 'Cancelar con el restaurante cerrado',
};
const ORDER = Object.keys(LABELS);
const GROUP_IDS = ['M5.1', 'M6.1', 'M6.2', 'M6.3'];

const results = [];
const record = (id, pass, detail) =>
  results.push({ id, label: LABELS[id], pass, detail });
const skip = (id, reason) =>
  results.push({ id, label: LABELS[id], pass: null, detail: reason });

// ===== M5.1 + M6.1 + M6.2 + M6.3: una cancelación y sus efectos =====
async function testCancelHappyPath() {
  const { status: createStatus, body: created } =
    await createReservation(dinerAActor);
  if (createStatus !== 201) {
    for (const id of GROUP_IDS) {
      record(
        id,
        false,
        `no se pudo crear la reserva de prueba (${createStatus}: ${created?.message ?? ''})`,
      );
    }
    return;
  }
  trackReservation('M5.1/M6.1/M6.2/M6.3', created.id);
  try {
    const { body: tablesBefore } = await getTables();
    const table = tablesBefore.find(
      (t) =>
        t.identifier === created.table.identifier && t.status === 'reserved',
    );
    if (!table) {
      for (const id of GROUP_IDS)
        record(id, false, 'no encontré la mesa asignada en GET /tables');
      return;
    }

    const forceThreshold = values['force-threshold'];
    let revertTables = null;
    try {
      if (forceThreshold) revertTables = await occupyOtherFreeTables(table.id);

      const { body: publicBefore } = await getPublic(dinerAActor);
      const { status: cancelStatus, body: cancelled } = await cancelReservation(
        dinerAActor,
        created.id,
      );
      const m51Pass =
        cancelStatus === 200 &&
        cancelled?.status === 'cancelled' &&
        typeof cancelled?.cancelledAt === 'string';
      record(
        'M5.1',
        m51Pass,
        m51Pass
          ? `200, status cancelled, cancelledAt ${cancelled.cancelledAt}`
          : `esperaba 200 cancelled; recibí ${cancelStatus} ${JSON.stringify(cancelled)}`,
      );
      if (!m51Pass) {
        for (const id of ['M6.1', 'M6.2', 'M6.3'])
          record(id, false, 'bloqueada: M5.1 falló');
        return;
      }

      const { body: tablesAfter } = await getTables();
      const tableAfter = tablesAfter.find((t) => t.id === table.id);
      const m61Pass = tableAfter?.status === 'available';
      record(
        'M6.1',
        m61Pass,
        m61Pass
          ? `mesa ${tableAfter.identifier}: reserved → available`
          : `mesa quedó en "${tableAfter?.status}"`,
      );

      const { body: publicAfter } = await getPublic(dinerAActor);
      const expectedAfter = expectedAvailabilityLevel(tablesAfter);
      let m62Pass = publicAfter.availability === expectedAfter;
      let m62Detail = `antes: ${publicBefore.availability} · después: ${publicAfter.availability} (esperado según las mesas: ${expectedAfter})`;
      if (forceThreshold) {
        const changed = publicBefore.availability !== publicAfter.availability;
        m62Pass = m62Pass && changed;
        m62Detail += changed
          ? ' · cruzó de nivel'
          : ' · no cruzó de nivel (inesperado, se forzó el umbral)';
      }
      record('M6.2', m62Pass, m62Detail);

      const { body: logs } = await getTableLogs(table.id);
      const latest = Array.isArray(logs) ? logs[0] : null;
      const m63Pass =
        latest?.source === 'reservation' &&
        latest?.previousStatus === 'reserved' &&
        latest?.newStatus === 'available';
      record(
        'M6.3',
        m63Pass,
        m63Pass
          ? 'table_logs: reserved → available, source "reservation"'
          : `última fila: ${JSON.stringify(latest)}`,
      );
    } finally {
      if (revertTables) await revertTables();
    }
  } finally {
    await freeActiveReservation(dinerAActor);
  }
}

// ===== M5.2: cancelar dos veces =====
async function testCancelTwice() {
  const { status: createStatus, body: created } =
    await createReservation(dinerAActor);
  if (createStatus !== 201) {
    return record(
      'M5.2',
      false,
      `no se pudo crear la reserva de prueba (${createStatus})`,
    );
  }
  trackReservation('M5.2', created.id);
  const first = await cancelReservation(dinerAActor, created.id);
  if (first.status !== 200) {
    return record(
      'M5.2',
      false,
      `la primera cancelación ya falló (${first.status})`,
    );
  }
  const second = await cancelReservation(dinerAActor, created.id);
  const pass =
    second.status === 409 &&
    second.body?.errorCode === 'RESERVATION_NOT_ACTIVE';
  record(
    'M5.2',
    pass,
    pass
      ? '409 RESERVATION_NOT_ACTIVE en la segunda cancelación'
      : `esperaba 409 RESERVATION_NOT_ACTIVE; recibí ${second.status} ${JSON.stringify(second.body)}`,
  );
}

// ===== M5.3: cancelar una reserva vencida =====
async function testCancelExpired() {
  if (!IS_LOCAL && !values['include-expired']) {
    return skip(
      'M5.3',
      'omitida: pasa --include-expired para correrla en Render (depende del TTL configurado allí)',
    );
  }
  const { status: createStatus, body: created } =
    await createReservation(dinerAActor);
  if (createStatus !== 201) {
    return record(
      'M5.3',
      false,
      `no se pudo crear la reserva de prueba (${createStatus})`,
    );
  }
  trackReservation('M5.3', created.id);
  try {
    const { body: pub } = await getPublic(dinerAActor);
    const ttlMinutes =
      Number(process.env.DINNO_RESERVATION_TTL_MINUTES) ||
      pub?.reservationTtlMinutes ||
      15;
    const waitMs = ttlMinutes * 60_000 + 20_000;
    console.log(
      `  M5.3: esperando ~${Math.round(waitMs / 1000)}s a que venza (TTL ${ttlMinutes} min)…`,
    );
    await sleep(waitMs);

    const cancel = await cancelReservation(dinerAActor, created.id);
    const afterCancel = await getReservation(dinerAActor, created.id);
    const pass =
      cancel.status === 409 &&
      cancel.body?.errorCode === 'RESERVATION_NOT_ACTIVE' &&
      afterCancel.body?.status === 'expired';
    record(
      'M5.3',
      pass,
      pass
        ? '409 RESERVATION_NOT_ACTIVE; GET /reservations/:id la muestra "expired"'
        : `cancelar: ${cancel.status} ${JSON.stringify(cancel.body)} · GET: ${JSON.stringify(afterCancel.body)}`,
    );
  } finally {
    await freeActiveReservation(dinerAActor);
  }
}

// ===== M5.4: comensal B cancela la reserva de A =====
async function testCancelOtherDiner() {
  if (!dinerB) {
    return skip(
      'M5.4',
      IS_LOCAL
        ? 'omitida: falta DINNO_DEV_DINER_B_ID (un solo comensal de prueba en local; no cuenta como falla)'
        : 'omitida: falta DINNO_DINER_B_TOKEN',
    );
  }
  if (!IS_LOCAL) {
    // Crea el perfil de B si es su primera vez, igual que el primer login real.
    await api('POST', '/diners/me', { actor: dinerB, body: {} });
  }
  const { status: createStatus, body: created } =
    await createReservation(dinerAActor);
  if (createStatus !== 201) {
    return record(
      'M5.4',
      false,
      `no se pudo crear la reserva de A (${createStatus})`,
    );
  }
  trackReservation('M5.4', created.id);
  try {
    const attempt = await cancelReservation(dinerB, created.id);
    const stillActive = await getReservation(dinerAActor, created.id);
    const pass =
      attempt.status === 404 &&
      attempt.body?.errorCode === 'RESERVATION_NOT_FOUND' &&
      stillActive.body?.status === 'active';
    record(
      'M5.4',
      pass,
      pass
        ? '404 RESERVATION_NOT_FOUND para B; la reserva de A sigue activa'
        : `B recibió ${attempt.status} ${JSON.stringify(attempt.body)} · estado de A: ${stillActive.body?.status}`,
    );
  } finally {
    await freeActiveReservation(dinerAActor);
  }
}

// ===== M6.4: cancelar con el restaurante cerrado =====
async function testCancelWithRestaurantClosed() {
  const { status: createStatus, body: created } =
    await createReservation(dinerAActor);
  if (createStatus !== 201) {
    return record(
      'M6.4',
      false,
      `no se pudo crear la reserva de prueba (${createStatus})`,
    );
  }
  trackReservation('M6.4', created.id);
  try {
    const { body: statusBefore } = await getStatus();
    const wasOpen = statusBefore.isOpen;
    try {
      if (wasOpen) await setOpen(false);

      const cancel = await cancelReservation(dinerAActor, created.id);
      const { body: tablesAfter } = await getTables();
      const table = tablesAfter.find(
        (t) => t.identifier === created.table.identifier,
      );
      const { body: pub } = await getPublic(dinerAActor);

      let notSearchable = pub.availability === 'closed';
      if (Number.isFinite(pub.latitude) && Number.isFinite(pub.longitude)) {
        const { body: found } = await search(
          dinerAActor,
          pub.latitude,
          pub.longitude,
        );
        notSearchable =
          notSearchable &&
          Array.isArray(found) &&
          !found.some((r) => r.id === RESTAURANT_ID);
      }

      const pass =
        cancel.status === 200 && table?.status === 'available' && notSearchable;
      record(
        'M6.4',
        pass,
        pass
          ? 'cancela con el restaurante cerrado; la mesa vuelve a available y sigue sin aparecer en la búsqueda'
          : `cancelar: ${cancel.status} · mesa: ${table?.status} · availability: ${pub.availability}`,
      );
    } finally {
      if (wasOpen) await setOpen(true);
    }
  } finally {
    await freeActiveReservation(dinerAActor);
  }
}

async function finalSafetyCleanup() {
  try {
    await freeActiveReservation(dinerAActor);
  } catch (error) {
    console.error('Aviso: no pude limpiar la reserva de A:', error.message);
  }
  if (dinerB) {
    try {
      await freeActiveReservation(dinerB);
    } catch (error) {
      console.error('Aviso: no pude limpiar la reserva de B:', error.message);
    }
  }
  try {
    const { body } = await getStatus();
    if (body?.isOpen === false) await setOpen(true);
  } catch (error) {
    console.error(
      'Aviso: no pude confirmar que el restaurante quedara abierto:',
      error.message,
    );
  }
}

const RUNNERS = [
  { ids: GROUP_IDS, run: testCancelHappyPath },
  { ids: ['M5.2'], run: testCancelTwice },
  { ids: ['M5.4'], run: testCancelOtherDiner },
  { ids: ['M6.4'], run: testCancelWithRestaurantClosed },
  { ids: ['M5.3'], run: testCancelExpired }, // al final: es la más lenta (espera el TTL)
];

function printTable() {
  const sorted = [...results].sort(
    (a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id),
  );
  const statusText = (pass) =>
    pass === null ? 'Omitida' : pass ? 'Pasa' : 'Falla';
  console.log(
    '\nID    · Variante                               · Estado  · Detalle',
  );
  console.log('-'.repeat(110));
  for (const r of sorted) {
    console.log(
      `${r.id.padEnd(5)} · ${r.label.padEnd(38)} · ${statusText(r.pass).padEnd(7)} · ${r.detail}`,
    );
  }
  console.log('');
}

// Qué creó o tocó el script y en qué quedó, para que quede claro si hace
// falta avisarle a Elizabeth (demo:reset) por algo que no volvió a su sitio.
async function printCleanupSummary() {
  console.log('--- Resumen de limpieza ---');
  let anythingWrong = false;

  console.log(`Reservas creadas (${createdReservations.length}):`);
  for (const { id, variant } of createdReservations) {
    const { body } = await getReservation(dinerAActor, id);
    console.log(
      `  ${id}  ${variant}  estado final: ${body?.status ?? 'desconocido'}`,
    );
    if (body?.status === 'active') anythingWrong = true;
  }
  if (createdReservations.length === 0) console.log('  (ninguna)');

  console.log(
    `\nMesas tocadas directamente por el script (${touchedTables.length}):`,
  );
  if (touchedTables.length > 0) {
    const { body: tablesNow } = await getTables();
    for (const { tableId, identifier, before } of touchedTables) {
      const current =
        tablesNow.find((t) => t.id === tableId)?.status ?? 'desconocido';
      const ok = current === before;
      if (!ok) anythingWrong = true;
      console.log(
        `  ${identifier}  antes: ${before} → ahora: ${current}  ${ok ? 'OK (volvió a su estado)' : '⚠ NO volvió a su estado original'}`,
      );
    }
  } else {
    console.log('  (ninguna — no se usó --force-threshold)');
  }

  if (restaurantInitialOpen !== null) {
    const { body: statusNow } = await getStatus();
    const ok = statusNow?.isOpen === restaurantInitialOpen;
    if (!ok) anythingWrong = true;
    console.log(
      `\nRestaurante: estaba ${restaurantInitialOpen ? 'abierto' : 'cerrado'} antes · está ${statusNow?.isOpen ? 'abierto' : 'cerrado'} ahora  ${ok ? 'OK' : '⚠ NO quedó como estaba'}`,
    );
  }

  if (anythingWrong) {
    console.error(
      '\n⚠ Algo no quedó exactamente como estaba. Revisa el restaurante a mano antes de avisar que terminó, y si hace falta pídele a Elizabeth que corra demo:reset.',
    );
  }
  console.log('');
}

async function main() {
  const only = values.only;
  if (only && !RUNNERS.some((r) => r.ids.includes(only))) {
    die(`--only ${only} no es un ID válido. Usa uno de: ${ORDER.join(', ')}.`);
  }

  console.log(`Ambiente: ${IS_LOCAL ? 'local' : 'Render'} (${BASE_URL})`);
  const restaurant = await assertAdminMatchesRestaurant();
  console.log(`Restaurante: ${restaurant.name} (${RESTAURANT_ID})`);

  await finalSafetyCleanup(); // por si quedó algo activo de una corrida anterior
  const { body: initialStatus } = await getStatus();
  restaurantInitialOpen = initialStatus.isOpen;

  try {
    for (const runner of RUNNERS) {
      if (only && !runner.ids.includes(only)) continue;
      try {
        await runner.run();
      } catch (error) {
        for (const id of runner.ids) {
          if (!results.some((r) => r.id === id)) {
            record(id, false, `error inesperado: ${error.message}`);
          }
        }
      }
    }
  } finally {
    await finalSafetyCleanup();
  }

  const finalResults = only ? results.filter((r) => r.id === only) : results;
  results.length = 0;
  results.push(...finalResults);
  printTable();
  await printCleanupSummary();

  process.exit(results.some((r) => r.pass === false) ? 1 : 0);
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
