// Migración 060: liga y división, en tablas reales (reemplazan al
// texto plano liga_ranking de la migración 059).
export interface Liga {
  id: string;
  nombre: string;
}

export interface DivisionLiga {
  id: string;
  liga_id: string;
  nombre: string;
  mmr_limite: number | null;
}

// Fila devuelta por ranking_clanes() (migración 060): un equipo por
// fila, ya ordenado por torneos ganados desc, nombre asc.
export interface RankingClan {
  team_id: string;
  team_name: string;
  team_tag: string;
  logo_url: string | null;
  torneos_ganados: number;
}

// Fila devuelta por ranking_jugadores() (migración 063): un jugador
// por fila, ya ordenada por victorias totales desc, nick asc. team_*
// vienen en null si el jugador no pertenece a ningún equipo.
export interface RankingJugador {
  jugador_id: string;
  nick: string | null;
  unique_id: string;
  liga: string | null;
  raza_principal: string | null;
  team_id: string | null;
  team_name: string | null;
  team_tag: string | null;
  team_logo_url: string | null;
  victorias: number;
}
