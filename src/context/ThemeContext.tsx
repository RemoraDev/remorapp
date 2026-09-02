import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

// Selector de tema claro/oscuro (pestaña "Apariencia" de /perfil). El
// tema oscuro ("halcón") es el diseño original de toda la app -- el
// claro es un juego de tokens alternativo definido en halcon.css bajo
// :root[data-theme="claro"]. Se aplica como atributo en <html> para
// que el CSS lo tome sin JS adicional en cada componente.
export type TemaVisual = "oscuro" | "claro";

const CLAVE_STORAGE = "remorapp-tema";

interface ThemeContextValue {
  tema: TemaVisual;
  setTema: (tema: TemaVisual) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function leerTemaGuardado(): TemaVisual {
  if (typeof window === "undefined") return "oscuro";
  const guardado = window.localStorage.getItem(CLAVE_STORAGE);
  return guardado === "claro" ? "claro" : "oscuro";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTemaState] = useState<TemaVisual>(leerTemaGuardado);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema);
    window.localStorage.setItem(CLAVE_STORAGE, tema);
  }, [tema]);

  const setTema = (nuevoTema: TemaVisual) => setTemaState(nuevoTema);

  return <ThemeContext.Provider value={{ tema, setTema }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme debe usarse dentro de ThemeProvider");
  return context;
}
