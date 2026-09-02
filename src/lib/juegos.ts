import { supabase } from "./supabaseClient";

// StarCraft II todavía es el único juego real de la plataforma -- esta
// función es el único lugar que sabe buscarlo por nombre, para no
// repetir la misma consulta en cada página que necesita su id.
export async function obtenerJuegoIdSc2(): Promise<string | null> {
  const { data } = await supabase
    .from("catalogo_juegos")
    .select("id")
    .eq("nombre", "StarCraft II")
    .maybeSingle();
  return data?.id ?? null;
}
