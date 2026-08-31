# RemorApp

Frontend de RemorApp — torneos de videojuegos. React + Vite + TypeScript,
sin frameworks de CSS (estilos propios en [src/styles/halcon.css](src/styles/halcon.css)),
navegación con `react-router-dom` y autenticación/datos con Supabase.

## Configurar Supabase

1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. Copia `.env.example` a `.env`.
3. Completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con los valores de
   tu proyecto (Project Settings → API).

## Correr en local

```
npm install
npm run dev
```

Luego abre la URL que muestre Vite (por defecto http://localhost:5173).

## Estructura

- `src/pages` — una página por ruta (`/`, `/tournaments`, `/news`, `/store`,
  `/login`, `/register`).
- `src/components` — piezas de UI reutilizables.
- `src/context/AuthContext.tsx` — sesión de Supabase Auth disponible vía
  `useAuth()`.
- `src/lib/supabaseClient.ts` — cliente único de Supabase.
- `src/styles/halcon.css` — sistema de diseño (tema neón azul/cian).

La lógica de datos vive separada de las páginas para facilitar una futura
migración a Next.js si hace falta.
