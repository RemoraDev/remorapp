import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

// Selector de "SkinWeb" (pestaña Apariencia de /perfil): recolorea el
// acento de TODA la app (botones, bordes, brillos), a diferencia del
// selector oscuro/claro de ThemeContext, que cambia fondo/texto. Usa
// el mismo mecanismo que data-tema-equipo (halcon.css, migración 033,
// aplicado solo a la página pública de un equipo) pero con el atributo
// puesto en <html> para que alcance a toda la app. "actual" no tiene
// bloque de CSS propio: cae en los valores base de :root (cian).
export type SkinWeb = "actual" | "cian" | "violeta" | "rosa";

// Catálogo para el selector visual (Apariencia > SkinWeb). "actual" no
// tiene bloque de CSS propio (ver halcon.css) por eso reutiliza el
// mismo color de acento que "cian" en el swatch.
export const SKINS_WEB: { value: SkinWeb; label: string; color: string }[] = [
  { value: "actual", label: "Estilo actual", color: "#22d3ee" },
  { value: "cian", label: "Neon Cian", color: "#22d3ee" },
  { value: "violeta", label: "Neon Violeta", color: "#a78bfa" },
  { value: "rosa", label: "Neon Rosa", color: "#f472b6" },
];

const CLAVE_STORAGE = "remorapp-skin-web";

interface SkinWebContextValue {
  skinWeb: SkinWeb;
  setSkinWeb: (skin: SkinWeb) => void;
}

const SkinWebContext = createContext<SkinWebContextValue | undefined>(undefined);

function leerSkinGuardado(): SkinWeb {
  if (typeof window === "undefined") return "actual";
  const guardado = window.localStorage.getItem(CLAVE_STORAGE);
  return guardado === "cian" || guardado === "violeta" || guardado === "rosa" ? guardado : "actual";
}

export function SkinWebProvider({ children }: { children: ReactNode }) {
  const [skinWeb, setSkinWebState] = useState<SkinWeb>(leerSkinGuardado);

  useEffect(() => {
    document.documentElement.setAttribute("data-skin-web", skinWeb);
    window.localStorage.setItem(CLAVE_STORAGE, skinWeb);
  }, [skinWeb]);

  const setSkinWeb = (nuevoSkin: SkinWeb) => setSkinWebState(nuevoSkin);

  return <SkinWebContext.Provider value={{ skinWeb, setSkinWeb }}>{children}</SkinWebContext.Provider>;
}

export function useSkinWeb() {
  const context = useContext(SkinWebContext);
  if (!context) throw new Error("useSkinWeb debe usarse dentro de SkinWebProvider");
  return context;
}
