import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const webPort = Number(process.env.WEB_PORT || env.WEB_PORT || 5173);
  const previewPort = Number(process.env.PREVIEW_PORT || env.PREVIEW_PORT || 4173);
  const serverPort = Number(process.env.PORT || env.PORT || 3000);
  const serverTarget = `http://127.0.0.1:${serverPort}`;

  return {
    plugins: [react()],
    envDir: repoRoot,
    server: {
      port: webPort,
      // Worktrees share one machine; fail loudly instead of silently drifting
      // to a different port when WEB_PORT is already taken.
      strictPort: true,
      proxy: {
        "/api": serverTarget,
        "/matchmake": {
          target: serverTarget,
          changeOrigin: true,
        },
        "/colyseus": {
          target: serverTarget,
          ws: true,
        },
      },
    },
    preview: {
      port: previewPort,
      host: "0.0.0.0",
      strictPort: true,
    },
    optimizeDeps: {
      // MapLibre ships a worker module that the Vite dep optimizer cannot
      // pre-bundle; leave it to the native dev pipeline to avoid a broken
      // maplibre-gl-worker.mjs in .vite/deps.
      exclude: ["maplibre-gl"],
    },
    test: {
      globals: true,
      include: ["src/tests/**/*.test.{ts,tsx}"],
      environment: "jsdom",
      setupFiles: ["./src/tests/setup.ts"],
      css: true,
    },
  };
});
