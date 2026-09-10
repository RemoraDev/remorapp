import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

// Selector de "SkinWeb" (pestaña Apariencia de /perfil): recolorea el
// acento de TODA la app (botones, bordes, brillos), a diferencia del
// selector oscuro/claro de ThemeContext, que cambia fondo/texto. Usa
// el mismo mecanismo que data-tema-equipo (halcon.css, migración 033,
// aplicado solo a la página pública de un equipo) pero con el atributo
// puesto en <html> para que alcance a toda la app. "actual" no tiene
// bloque de CSS propio: cae en los valores base de :root (cian).
export type SkinWeb =
  | "actual"
  | "cafe"
  | "blanco"
  | "azul-petroleo"
  | "amarillo"
  | "rojo"
  | "azul"
  | "verde-claro"
  | "verde-oscuro"
  | "naranja"
  | "violeta"
  | "celeste"
  | "rosa";

const VALORES_SKIN_WEB: SkinWeb[] = [
  "actual",
  "cafe",
  "blanco",
  "azul-petroleo",
  "amarillo",
  "rojo",
  "azul",
  "verde-claro",
  "verde-oscuro",
  "naranja",
  "violeta",
  "celeste",
  "rosa",
];

// Catálogo para el selector visual (Apariencia > SkinWeb). "actual" no
// tiene bloque de CSS propio (ver halcon.css) por eso reutiliza el
// mismo color de acento base (cian) en el swatch.
export const SKINS_WEB: { value: SkinWeb; label: string; color: string }[] = [
  { value: "actual", label: "Estilo actual", color: "#22d3ee" },
  { value: "cafe", label: "Café", color: "#92400e" },
  { value: "blanco", label: "Blanco", color: "#f8fafc" },
  { value: "azul-petroleo", label: "Azul petróleo", color: "#0f766e" },
  { value: "amarillo", label: "Amarillo", color: "#facc15" },
  { value: "rojo", label: "Rojo", color: "#f87171" },
  { value: "azul", label: "Azul", color: "#4f46e5" },
  { value: "verde-claro", label: "Verde claro", color: "#84cc16" },
  { value: "verde-oscuro", label: "Verde oscuro", color: "#047857" },
  { value: "naranja", label: "Naranja", color: "#fb923c" },
  { value: "violeta", label: "Violeta", color: "#a78bfa" },
  { value: "celeste", label: "Celeste", color: "#38bdf8" },
  { value: "rosa", label: "Rosa", color: "#f472b6" },
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
  return (VALORES_SKIN_WEB as string[]).includes(guardado ?? "") ? (guardado as SkinWeb) : "actual";
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
