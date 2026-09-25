import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Evita que el watcher de Vite vigile src-tauri/target: ahí es donde
  // Cargo escribe la compilación de Rust (migración de la versión de
  // escritorio) -- sin este ignore, "tauri dev" hace crashear a Vite
  // con un EBUSY apenas Cargo toca un archivo ahí adentro mientras
  // compila, porque los dos procesos corren en paralelo.
  server: {
    watch: {
      // RegExp en vez de glob: en Windows, el glob "**/src-tauri/**" no
      // alcanza a filtrar los archivos que toca Cargo (separador de
      // carpetas con backslash, no barra) y el EBUSY seguía pasando.
      ignored: [/[\\/]src-tauri[\\/]target[\\/]/],
    },
  },
  plugins: [
    react(),
    // Migración 098: instalable como app (ícono propio, ventana sin la
    // barra del navegador) -- usa el mismo diseño del favicon actual
    // (círculo oscuro + "R" en acento cian), ya rasterizado a 192/512px
    // en public/icons/.
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "RemorApp — Torneos de videojuegos",
        short_name: "RemorApp",
        description: "Torneos, ligas y Clan Wars de StarCraft II.",
        lang: "es",
        start_url: "/",
        display: "standalone",
        background_color: "#06070a",
        theme_color: "#06070a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
