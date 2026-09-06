// Fila devuelta por clan_wars_proximas() (migración 059, extendida en
// la 064 con liga_nombre/division_nombre): versión pública de una Clan
// War programada, sin las columnas privadas del lineup ni el motivo de
// rechazo -- mismo espíritu que overlay_clan_war().
export interface ClanWarProxima {
  id: string;
  fecha_hora_cet: string;
  formato: "simple" | "wtl";
  challenger_nombre: string;
  challenger_tag: string;
  challenger_logo_url: string | null;
  challenged_nombre: string;
  challenged_tag: string;
  challenged_logo_url: string | null;
  // Null cuando la Clan War no tiene una temporada de torneo asociada
  // -- es el caso normal para la inmensa mayoría de las Clan Wars.
  liga_nombre: string | null;
  division_nombre: string | null;
}
