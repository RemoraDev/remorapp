import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

interface OverlayEquipo {
  nombre: string;
  tag: string;
  logo_url: string | null;
}

interface OverlayWtlSet {
  posicion: 1 | 2 | 3;
  jugador_challenger: string;
  jugador_challenged: string;
  mapas_ganados_challenger: number;
  mapas_ganados_challenged: number;
  status: "pendiente" | "jugado";
}

interface OverlayAce {
  challenger: string;
  challenged: string;
  ganador: "challenger" | "challenged" | null;
}

interface OverlayPartidaSimple {
  jugador_challenger: string;
  jugador_challenged: string;
  status: "pendiente" | "jugado";
}

interface OverlayClanWarDatos {
  formato: "simple" | "wtl";
  status: string;
  fecha_hora_cet: string;
  challenger: OverlayEquipo;
  challenged: OverlayEquipo;
  resultado_mapas_challenger: number;
  resultado_mapas_challenged: number;
  wtl_sets: OverlayWtlSet[] | null;
  ace: OverlayAce | null;
  partida_actual_simple: OverlayPartidaSimple | null;
  ganadas_challenger: number | null;
  ganadas_challenged: number | null;
}

const INTERVALO_MS = 7000;

// Overlay de Clan War para OBS (migración 044): página pública, sin
// login, fondo transparente -- pensada para pegarse como "Browser
// Source" en una transmisión. Todo el dato sensible (motivo de
// rechazo, link del caster, quién armó el lineup, etc.) queda afuera
// a propósito: overlay_clan_war() en la base arma un jsonb con SOLO lo
// que hace falta para el marcador, ver esa función para el detalle.
export default function OverlayClanWarPage() {
  const { id } = useParams<{ id: string }>();
  const [datos, setDatos] = useState<OverlayClanWarDatos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);

  useEffect(() => {
    // Fondo transparente de verdad: body trae un fondo oscuro fijo
    // (ver halcon.css) pensado para el resto de la app -- acá se
    // anula mientras esta página está montada, y se restaura al salir.
    document.body.classList.add("overlay-obs");
    return () => {
      document.body.classList.remove("overlay-obs");
    };
  }, []);

  useEffect(() => {
    if (!id) return;

    let cancelado = false;

    const cargar = async () => {
      const { data, error } = await supabase.rpc("overlay_clan_war", { p_clan_war_id: id });
      if (cancelado) return;

      // Sin spinner ni parpadeo entre refrescos: "cargando" solo se
      // usa para la primera carga, después el estado se actualiza en
      // silencio -- así no se nota el refresco en la transmisión.
      if (error || !data) {
        setNoEncontrado(true);
      } else {
        setDatos(data as OverlayClanWarDatos);
      }
      setCargando(false);
    };

    cargar();
    const intervalo = setInterval(cargar, INTERVALO_MS);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, [id]);

  if (cargando) return null;

  if (noEncontrado || !datos) {
    return (
      <div className="overlay-page">
        <p className="overlay-error">Clan War no encontrada.</p>
      </div>
    );
  }

  return (
    <div className="overlay-page">
      <div className="overlay-cw-header">
        <div className="overlay-cw-equipo">
          {datos.challenger.logo_url && <img src={datos.challenger.logo_url} alt="" className="overlay-cw-logo" />}
          <span className="overlay-cw-nombre">
            {datos.challenger.nombre} <span className="overlay-cw-tag">[{datos.challenger.tag}]</span>
          </span>
        </div>

        <div className="overlay-cw-marcador-global">
          {datos.resultado_mapas_challenger} - {datos.resultado_mapas_challenged}
        </div>

        <div className="overlay-cw-equipo overlay-cw-equipo-derecha">
          <span className="overlay-cw-nombre">
            <span className="overlay-cw-tag">[{datos.challenged.tag}]</span> {datos.challenged.nombre}
          </span>
          {datos.challenged.logo_url && <img src={datos.challenged.logo_url} alt="" className="overlay-cw-logo" />}
        </div>
      </div>

      {datos.formato === "wtl" && datos.wtl_sets && (
        <div className="overlay-cw-sets">
          {datos.wtl_sets.map((s) => (
            <div key={s.posicion} className={`overlay-cw-set ${s.status === "jugado" ? "jugado" : "en-juego"}`}>
              <span className="overlay-cw-set-posicion">#{s.posicion}</span>
              <span className="overlay-cw-set-jugador">{s.jugador_challenger}</span>
              <span className="overlay-cw-set-marcador">
                {s.mapas_ganados_challenger} - {s.mapas_ganados_challenged}
              </span>
              <span className="overlay-cw-set-jugador">{s.jugador_challenged}</span>
            </div>
          ))}
        </div>
      )}

      {datos.formato === "wtl" && datos.ace && (
        <div className="overlay-cw-ace">
          <span className="overlay-cw-ace-label">ACE</span>
          <span className={datos.ace.ganador === "challenger" ? "overlay-cw-ace-ganador" : ""}>
            {datos.ace.challenger}
          </span>
          <span className="overlay-cw-ace-vs">vs</span>
          <span className={datos.ace.ganador === "challenged" ? "overlay-cw-ace-ganador" : ""}>
            {datos.ace.challenged}
          </span>
        </div>
      )}

      {datos.formato === "simple" && (
        <div className="overlay-cw-sets">
          <div className="overlay-cw-set jugado">
            <span className="overlay-cw-set-posicion">Partidas</span>
            <span className="overlay-cw-set-marcador">
              {datos.ganadas_challenger} - {datos.ganadas_challenged}
            </span>
          </div>
          {datos.partida_actual_simple && (
            <div className="overlay-cw-set en-juego">
              <span className="overlay-cw-set-jugador">{datos.partida_actual_simple.jugador_challenger}</span>
              <span className="overlay-cw-set-marcador">vs</span>
              <span className="overlay-cw-set-jugador">{datos.partida_actual_simple.jugador_challenged}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
