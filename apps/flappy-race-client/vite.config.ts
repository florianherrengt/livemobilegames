import { defineConfig } from "vite";

export default defineConfig({
  base: "/flappy-race/",
  server: {
    host: "0.0.0.0",
    port: 5177,
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
