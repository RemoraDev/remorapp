import { supabase } from "./supabaseClient";
import type { ComunidadRow, EventoComunidad } from "../types/comunidades";

// Comunidades a las que este usuario pertenece (como creador o como
// integrante de unión libre) -- usado por BottomNav.tsx (para decidir
// si mostrar "Mi comunidad"/"Mis Eventos" y a dónde mandar "Mi
// comunidad") y por MisEventosPage.tsx (una pestaña por comunidad).
export async function obtenerComunidadesDelUsuario(userId: string): Promise<ComunidadRow[]> {
  const { data } = await supabase
    .from("comunidad_miembros")
    .select("comunidades(*)")
    .eq("user_id", userId);

  return (data ?? [])
    .map((fila) => {
      const comunidad = Array.isArray(fila.comunidades) ? fila.comunidades[0] : fila.comunidades;
      return (comunidad as ComunidadRow | undefined) ?? null;
    })
    .filter((c): c is ComunidadRow => c !== null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Torneos por ligas, Race War y Clan War Amistosa vinculados a una
// comunidad puntual (tournaments.comunidad_id/clan_wars.comunidad_id) --
// mismo patrón que eventos_publicos() en la base, pero filtrado a una
// sola comunidad y resuelto en el cliente (no hay una RPC propia para
// esto todavía).
export async function obtenerEventosDeComunidad(comunidadId: string): Promise<EventoComunidad[]> {
  const { data: torneosData } = await supabase
    .from("tournaments")
    .select("id, nombre, fecha_inicio")
    .eq("comunidad_id", comunidadId)
    .order("fecha_inicio", { ascending: false });

  const torneoIds = (torneosData ?? []).map((t) => t.id as string);
  let raceWarIdPorTorneo: Record<string, string> = {};

  if (torneoIds.length > 0) {
    const { data: raceWarsData } = await supabase
      .from("guerra_razas")
      .select("id, tournament_id")
      .in("tournament_id", torneoIds);

    raceWarIdPorTorneo = (raceWarsData ?? []).reduce<Record<string, string>>((acc, g) => {
      acc[g.tournament_id as string] = g.id as string;
      return acc;
    }, {});
  }

  const eventosTorneos: EventoComunidad[] = (torneosData ?? []).map((t) => {
    const raceWarId = raceWarIdPorTorneo[t.id as string];
    return raceWarId
      ? { tipo: "race_war", id: raceWarId, titulo: t.nombre as string, fecha: t.fecha_inicio as string, href: `/guerra-razas/${raceWarId}` }
      : { tipo: "torneo", id: t.id as string, titulo: t.nombre as string, fecha: t.fecha_inicio as string, href: `/tournaments/${t.id}` };
  });

  const { data: clanWarsData } = await supabase
    .from("clan_wars")
    .select("id, fecha_hora_cet, titulo, challenger:teams!challenger_team_id(tag), challenged:teams!challenged_team_id(tag)")
    .eq("comunidad_id", comunidadId)
    .order("fecha_hora_cet", { ascending: false });

  const eventosClanWars: EventoComunidad[] = (clanWarsData ?? []).map((cw) => {
    const challenger = Array.isArray(cw.challenger) ? cw.challenger[0] : cw.challenger;
    const challenged = Array.isArray(cw.challenged) ? cw.challenged[0] : cw.challenged;
    return {
      tipo: "clan_war_amistosa",
      id: cw.id as string,
      titulo: (cw.titulo as string | null) ?? `${challenger?.tag ?? "?"} vs ${challenged?.tag ?? "?"}`,
      fecha: cw.fecha_hora_cet as string,
      href: `/clan-war/${cw.id}`,
    };
  });

  return [...eventosTorneos, ...eventosClanWars].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );
}
