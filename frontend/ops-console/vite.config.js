import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by frontend/server.mjs at /crystal-clean/ops (API calls go to the same origin and are proxied).
export default defineConfig({
  plugins: [react()],
  base: "/crystal-clean/ops/",
  build: { outDir: "../dist/crystal-clean/ops", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
