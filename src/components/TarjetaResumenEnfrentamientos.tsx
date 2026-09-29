import { forwardRef } from "react";
import { CATEGORIAS_GUERRA, RAZAS_GUERRA } from "../types/guerraRazas";
import type { CategoriaGuerra, GuerraRazasEncuentroRow, GuerraRazasJugadorRow, GuerraRazasRow, RazaGuerra } from "../types/guerraRazas";

const IMAGEN_DEFAULT: Record<RazaGuerra, string> = {
  protoss: "/razas/protoss.webp",
  terran: "/razas/terran.webp",
  zerg: "/razas/zerg.webp",
};

const CAMPO_JUGADOR: Record<RazaGuerra, "jugador_protoss_id" | "jugador_terran_id" | "jugador_zerg_id"> = {
  protoss: "jugador_protoss_id",
  terran: "jugador_terran_id",
  zerg: "jugador_zerg_id",
};

const CAMPO_IMAGEN_ENC: Record<RazaGuerra, "imagen_protoss_url" | "imagen_terran_url" | "imagen_zerg_url"> = {
  protoss: "imagen_protoss_url",
  terran: "imagen_terran_url",
  zerg: "imagen_zerg_url",
};

interface Props {
  guerra: GuerraRazasRow;
  jugadores: GuerraRazasJugadorRow[];
  encuentros: Record<CategoriaGuerra, GuerraRazasEncuentroRow | null>;
}

// Tarjeta que combina los encuentros ACTUALES de las 5 categorías en
// una sola imagen para compartir de un saque -- en vez de un
// triángulo completo por categoría (no entra 5 veces en una sola
// imagen legible), cada categoría es un mini-resumen: sus 3 jugadores
// elegidos, uno por raza, con el mismo resaltado azul que la pestaña
// Enfrentamiento. Se monta siempre fuera de la pantalla (ver el
// contenedor de recorte en GuerraDeRazasPage.tsx) y solo se captura
// como imagen al tocar "Compartir todas las categorías".
const TarjetaResumenEnfrentamientos = forwardRef<HTMLDivElement, Props>(({ guerra, jugadores, encuentros }, ref) => {
  return (
    <div ref={ref} className="guerra-razas-resumen-card">
      <div className="guerra-razas-compartir-marca">RemorApp</div>
      <h2 className="guerra-razas-resumen-titulo">{guerra.titulo || "Race War"}</h2>
      <p className="guerra-razas-resumen-subtitulo">Enfrentamientos actuales</p>

      <div className="guerra-razas-resumen-grid">
        {CATEGORIAS_GUERRA.map(({ value: categoria, label }) => {
          const encuentro = encuentros[categoria];
          return (
            <div key={categoria} className="guerra-razas-resumen-categoria">
              <p className="guerra-razas-resumen-categoria-titulo">{label}</p>
              {!encuentro ? (
                <p className="guerra-razas-resumen-vacio">Sin enfrentamiento activo.</p>
              ) : (
                <div className="guerra-razas-resumen-jugadores">
                  {RAZAS_GUERRA.map(({ value: raza, label: labelRaza }) => {
                    const jugadorId = encuentro[CAMPO_JUGADOR[raza]];
                    const jugador = jugadores.find((j) => j.id === jugadorId);
                    const imagenUrl = encuentro[CAMPO_IMAGEN_ENC[raza]] || IMAGEN_DEFAULT[raza];
                    return (
                      <div key={raza} className="guerra-razas-resumen-jugador-fila">
                        <img src={imagenUrl} alt="" className="guerra-razas-resumen-jugador-img" />
                        <span className="guerra-razas-resumen-jugador-raza">{labelRaza}</span>
                        <span className="guerra-razas-resumen-jugador-nombre">{jugador?.nombre ?? "Sin jugador"}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

TarjetaResumenEnfrentamientos.displayName = "TarjetaResumenEnfrentamientos";

export default TarjetaResumenEnfrentamientos;
