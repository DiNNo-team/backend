# Pruebas de red desde distintos lugares · Sprint 4

**Dueño:** Sebastián (reparto §4.2) · **Herramienta:** `scripts/qa/humo-red.mjs`.
**Cuándo:** antes de la presentación desde las tres redes (casa, universidad y datos móviles), y de nuevo después de **cualquier** cambio de red, firewall o secretos.
**Qué cuenta como «pasa»:** todos los pasos en OK con `CONFIRM=1`, incluidos los dos WebSocket. La app y la web también se prueban a mano en esa misma red: iniciar sesión, buscar, reservar, verla en la web y hacer el check-in.

## Cómo correrla

```bash
cd backend
BASE_URL=https://<api-de-azure> NETWORK_LABEL=universidad WEB_ORIGIN=https://<web-de-azure> \
FIREBASE_API_KEY=… DINER_EMAIL=… DINER_PASSWORD=… ADMIN_EMAIL=… ADMIN_PASSWORD=… \
RESTAURANT_ID=<casa-72> CONFIRM=1 node scripts/qa/humo-red.mjs
```

Sin las cuentas, solo corre el chequeo rápido (salud, cabeceras, 401 y CORS). Las credenciales se escriben en la terminal y nunca en un archivo.

## Resultados

| Fecha (Bogotá) | Red | API | Prueba | Resultado | Tiempo total |
|---|---|---|---|---|---|
| 16/11/2026, 11:48 p. m. | casa | Render (antes de #65) | rápido (sin sesión) | Salud y 401 bien. Faltan las cabeceras de seguridad (esperado: #65 aún no está desplegado). Render tardó 85 s en despertar | — |

## Lo que se aprendió

- **Render se duerme** en el plan gratuito: la primera petición tardó 85 s. En Azure, con `min-replicas 0`, pasa algo parecido al encender. Por eso el checklist de la presentación enciende con anticipación y llama a `/v1/health` antes de entrar.
