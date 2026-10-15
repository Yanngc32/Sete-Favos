import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Em dev o Vite fica só em localhost e repassa /api para a central.
// Não ligar `xfwd` nem expor o Vite na rede: a central trata loopback como "o PC".
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "localhost",
    proxy: { "/api": { target: "http://localhost:38471", ws: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
