import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  build: { outDir: "../server/public/app", emptyOutDir: true },
  server: {
    port: 5173,
    // Everything outside /app (API, sign-in page, tracker) comes from the TraceTray server. The Host
    // header stays as the browser sent it, because Clerk builds its sign-in return address from it.
    proxy: {
      "^/(?!app(/|$)).*": { target: process.env.VITE_API_PROXY || "http://localhost:5000", changeOrigin: false }
    },
    watch: process.env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined
  }
});
