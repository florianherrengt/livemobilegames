import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/capital-pin/",
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
  },
});
