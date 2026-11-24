// QA del tiempo real: se conecta al WebSocket como comensal e imprime cada
// availability.changed con la hora. Uso (README, "Tiempo real"):
//   node scripts/listen-availability.mjs --dev-user-id <uuid del comensal>
//   DINNO_TOKEN=<token de Firebase> node scripts/listen-availability.mjs --url https://dinno-backend.onrender.com
// --dev-user-id solo funciona en local con el usuario de desarrollo activo.
// El token también se acepta con --token, pero DINNO_TOKEN no lo deja en el
// historial de la terminal.
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    token: { type: 'string' },
    'dev-user-id': { type: 'string' },
  },
});

const token = values.token ?? process.env.DINNO_TOKEN;
const devUserId = values['dev-user-id'];
if (!token && !devUserId) {
  console.error(
    'Falta la identidad: usa --dev-user-id <uuid> (local) o DINNO_TOKEN / --token <token de Firebase>.',
  );
  process.exit(2);
}

const now = () => new Date().toLocaleTimeString('es-CO', { hour12: false });
const auth = token ? { token } : { devUserId };

const socket = io(values.url, { auth, transports: ['websocket'] });

socket.on('connect', () => {
  console.log(
    `[${now()}] Conectado a ${values.url} como comensal. Esperando eventos… (Ctrl+C para salir)`,
  );
});

socket.on('availability.changed', (payload) => {
  console.log(`[${now()}] availability.changed ${JSON.stringify(payload)}`);
});

// A rejection in the handshake is final: Socket.IO does not retry it.
socket.on('connect_error', (error) => {
  console.error(`[${now()}] connect_error: ${error.message}`);
  if (!socket.active) {
    process.exit(1);
  }
});

socket.on('disconnect', (reason) => {
  console.log(`[${now()}] Desconectado (${reason}).`);
});

process.on('SIGINT', () => {
  socket.disconnect();
  process.exit(0);
});
