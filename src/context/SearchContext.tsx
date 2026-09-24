import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import BuscadorGlobal from "../components/BuscadorGlobal";

interface SearchContextValue {
  abrirBuscador: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

// Migración 099: buscador global (Ctrl+K / Cmd+K) -- expone abrirBuscador()
// para que cualquier componente (el botón del header, un futuro atajo
// desde otro lugar) pueda abrirlo, sin tener que levantar el estado
// "abierto" hasta App.tsx a mano.
export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch() tiene que usarse dentro de <SearchProvider>.");
  return ctx;
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    // Ctrl+K en Windows/Linux, Cmd+K en Mac -- e.metaKey cubre Cmd.
    // preventDefault() porque algunos navegadores usan Ctrl+K para
    // enfocar su propia barra de direcciones.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setAbierto((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <SearchContext.Provider value={{ abrirBuscador: () => setAbierto(true) }}>
      {children}
      <BuscadorGlobal abierto={abierto} onClose={() => setAbierto(false)} />
    </SearchContext.Provider>
  );
}
