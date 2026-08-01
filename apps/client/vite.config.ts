import { defineConfig } from "vite";

export default defineConfig({
  base: "/falling-platforms/",
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
