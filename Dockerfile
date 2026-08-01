# syntax=docker/dockerfile:1

# ---------- Build ----------
FROM node:22-alpine AS build

WORKDIR /app

# Pin pnpm to the version declared in package.json (packageManager).
RUN npm install --global pnpm@10.33.4

# Some transitive dependencies (uWebSockets.js via Colyseus) resolve from git.
RUN apk add --no-cache git

COPY . .

# --ignore-scripts skips the root postinstall (Playwright browser download)
# and dependency build scripts; nothing in this workspace needs them.
RUN pnpm install --frozen-lockfile --ignore-scripts

ENV NODE_ENV=production

RUN pnpm build

# Deploy a self-contained production tree containing only the server and its
# runtime dependencies (colyseus, express, workspace packages). Client-only
# dependencies (Phaser, MapLibre, React) are not needed at runtime: Vite
# bundles them into the static dist/ directories.
RUN pnpm --filter @falling-platforms/server deploy --prod --legacy --ignore-scripts /app/runtime

# Colyseus re-exports most peer packages from its entry point, so they must
# stay. The uWebSockets transport is not imported anywhere in the runtime
# path and is by far the largest dependency (~115MB), so drop it explicitly.
RUN rm -rf /app/runtime/node_modules/.pnpm/@colyseus+uwebsockets-transport@* \
           /app/runtime/node_modules/.pnpm/uWebSockets.js@*

# ---------- Runtime ----------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=2567 \
    HOST=0.0.0.0

WORKDIR /app

# The server resolves the built client dist/ directories relative to its own
# location, so they keep their original app folder names.
COPY --from=build /app/runtime /app/server
COPY --from=build /app/apps/client/dist /app/client/dist
COPY --from=build /app/apps/tap-race-client/dist /app/tap-race-client/dist
COPY --from=build /app/apps/capital-pin-client/dist /app/capital-pin-client/dist
COPY --from=build /app/apps/hub-client/dist /app/hub-client/dist

USER node

EXPOSE 2567

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-2567}/health" || exit 1

CMD ["node", "server/dist/index.js"]
