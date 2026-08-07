import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const WORKER_DEV = "http://localhost:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Regex keys to bound the match: plain string keys match by prefix,
      // so "/s" would capture /src/main.tsx and "/f" would capture /favicon.ico.
      "/api": WORKER_DEV,
      "^/f/.+": WORKER_DEV,
      "^/s/.+": WORKER_DEV,
    },
  },
});
