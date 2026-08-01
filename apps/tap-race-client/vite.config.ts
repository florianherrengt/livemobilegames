import { defineConfig } from "vite";

export default defineConfig({
  base: "/tap-race/",
  server: {
    port: 5174,
    strictPort: true,
  },
});
