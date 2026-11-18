# Imagen del backend para Azure Container Apps (Sprint 4). Node 24, como .nvmrc.
# Sin secretos: todas las variables llegan del Container App (Key Vault).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
# Marca el ambiente como desplegado: la API escucha en 0.0.0.0 (no en
# 127.0.0.1) y no arranca con DEV_USER_ENABLED ni FIREBASE_AUTH_EMULATOR_HOST.
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
