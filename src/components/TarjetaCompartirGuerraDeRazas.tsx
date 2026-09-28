import { forwardRef } from "react";
import { RAZAS_GUERRA } from "../types/guerraRazas";
import type { GuerraRazasRow, RazaGuerra } from "../types/guerraRazas";

const IMAGEN_DEFAULT: Record<RazaGuerra, string> = {
  protoss: "/razas/protoss.webp",
  terran: "/razas/terran.webp",
  zerg: "/razas/zerg.webp",
};

const CAMPO_PUNTOS: Record<RazaGuerra, "puntos_protoss" | "puntos_terran" | "puntos_zerg"> = {
  protoss: "puntos_protoss",
  terran: "puntos_terran",
  zerg: "puntos_zerg",
};

const CAMPO_IMAGEN: Record<RazaGuerra, "imagen_protoss_url" | "imagen_terran_url" | "imagen_zerg_url"> = {
  protoss: "imagen_protoss_url",
  terran: "imagen_terran_url",
  zerg: "imagen_zerg_url",
};

interface Props {
  guerra: GuerraRazasRow;
}

// Tarjeta vertical (9:16, formato "historia" de celular) para compartir
// el marcador de un Race War fuera de la app -- WhatsApp Estados,
// Instagram Stories, etc. Es un componente aparte, no una captura de
// pantalla de la página real (esa es horizontal, tres columnas lado a
// lado -- no entra en un formato vertical sin quedar minúscula). Se
// monta siempre fuera de la pantalla (ver GuerraDeRazasPage.tsx) y se
// captura con html-to-image al tocar "Compartir".
const TarjetaCompartirGuerraDeRazas = forwardRef<HTMLDivElement, Props>(({ guerra }, ref) => {
  const ranking = (["protoss", "terran", "zerg"] as RazaGuerra[])
    .slice()
    .sort((a, b) => {
      const diff = guerra[CAMPO_PUNTOS[b]] - guerra[CAMPO_PUNTOS[a]];
      if (diff !== 0) return diff;
      return RAZAS_GUERRA.findIndex((r) => r.value === a) - RAZAS_GUERRA.findIndex((r) => r.value === b);
    });

  return (
    <div ref={ref} className="guerra-razas-compartir-card">
      <div className="guerra-razas-compartir-marca">RemorApp</div>
      <h2 className="guerra-razas-compartir-titulo">{guerra.titulo || "Race War"}</h2>

      <div className="guerra-razas-compartir-podio">
        {ranking.map((raza, indice) => {
          const label = RAZAS_GUERRA.find((r) => r.value === raza)?.label ?? raza;
          const imagenUrl = guerra[CAMPO_IMAGEN[raza]] || IMAGEN_DEFAULT[raza];
          return (
            <div
              key={raza}
              className={`guerra-razas-compartir-raza guerra-razas-raza-${raza} ${
                indice === 0 ? "guerra-razas-compartir-raza-primero" : ""
              }`}
            >
              <span className="guerra-razas-compartir-raza-lugar">{indice + 1}°</span>
              <img src={imagenUrl} alt="" className="guerra-razas-compartir-raza-img" />
              <span className="guerra-razas-compartir-raza-nombre">{label}</span>
              <span className="guerra-razas-compartir-raza-puntos">{guerra[CAMPO_PUNTOS[raza]]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

TarjetaCompartirGuerraDeRazas.displayName = "TarjetaCompartirGuerraDeRazas";

export default TarjetaCompartirGuerraDeRazas;
