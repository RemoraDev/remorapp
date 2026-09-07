import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import TarjetaLineupClanWar from "../components/TarjetaLineupClanWar";
import type { LineupPublicoClanWar } from "../types/clanWars";

const INTERVALO_MS = 7000;

// Overlay de lineup para OBS (migración 067): distinto del overlay de
// marcador en vivo (OverlayClanWarPage, para durante el juego) -- este
// es para pegar antes de que arranque el reto, mostrando la tarjeta de
// enfrentamientos con el fondo que haya elegido el capitán o el
// caster. Página pública, sin login, fondo transparente -- mismo
// patrón que el resto de /overlay/*.
export default function OverlayLineupClanWarPage() {
  const { id } = useParams<{ id: string }>();
  const [datos, setDatos] = useState<LineupPublicoClanWar | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    document.body.classList.add("overlay-obs");
    return () => {
      document.body.classList.remove("overlay-obs");
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelado = false;

    const cargar = async () => {
      const { data, error } = await supabase.rpc("lineup_publico_clan_war", { p_clan_war_id: id });
      if (cancelado) return;
      if (!error && data) setDatos(data as LineupPublicoClanWar);
      setCargando(false);
    };

    cargar();
    const intervalo = setInterval(cargar, INTERVALO_MS);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, [id]);

  if (cargando || !datos || !datos.revelado) return null;

  return (
    <div className="overlay-page overlay-page-lineup">
      <TarjetaLineupClanWar datos={datos} />
    </div>
  );
}
