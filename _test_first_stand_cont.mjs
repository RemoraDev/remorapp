import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://nvbvhengpvappqzailtc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_elKrBmtuHtrNS1K8m6beXg_R7CWo4WE";
const PASSWORD = "PruebaRemor2026!";
const TORNEO_ID = "3bcf99cc-4186-4a53-8079-fefc3b64162d";
const ORGANIZADOR_EMAIL = "remorapp.qa.firststand.org.539690@mailinator.com";

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await sb.auth.signInWithPassword({
    email: ORGANIZADOR_EMAIL,
    password: PASSWORD,
  });
  if (signInError) throw new Error(`signIn organizador: ${signInError.message}`);

  const { data: participantes, error: partError } = await sb
    .from("tournament_participants")
    .select("id, team_id, teams(name, tag)")
    .eq("tournament_id", TORNEO_ID);
  if (partError) throw new Error(`leer participantes: ${partError.message}`);

  const nombrePorParticipant = Object.fromEntries(
    participantes.map((p) => [p.id, Array.isArray(p.teams) ? p.teams[0]?.name : p.teams?.name])
  );

  const { data: bracket, error: bracketError } = await sb
    .from("bracket_matches")
    .select("id, round, match_number, participant1_id, participant2_id, formato_partido, es_tercer_lugar, status")
    .eq("tournament_id", TORNEO_ID)
    .order("round")
    .order("match_number");
  if (bracketError) throw new Error(`leer bracket: ${bracketError.message}`);

  console.log("=== Llave antes de jugar semifinales ===");
  for (const m of bracket) {
    console.log(
      `  Ronda ${m.round} #${m.match_number}: ${nombrePorParticipant[m.participant1_id] ?? "?"} vs ${
        nombrePorParticipant[m.participant2_id] ?? "?"
      } -- status=${m.status} formato_partido=${m.formato_partido}`
    );
  }

  const semis = bracket.filter((m) => m.round === 1);
  for (const semi of semis) {
    if (semi.status === "jugado") {
      console.log(`Semifinal #${semi.match_number} ya estaba jugada, se omite.`);
      continue;
    }
    const { error } = await sb.rpc("reportar_resultado", {
      p_match_id: semi.id,
      p_ganador_id: semi.participant1_id,
    });
    if (error) throw new Error(`reportar semifinal #${semi.match_number}: ${error.message}`);
    console.log(`Semifinal #${semi.match_number}: ganó ${nombrePorParticipant[semi.participant1_id]}.`);
  }

  const { data: finalRow, error: finalReadError } = await sb
    .from("bracket_matches")
    .select("id, participant1_id, participant2_id, formato_partido, status")
    .eq("tournament_id", TORNEO_ID)
    .eq("round", 2)
    .eq("es_tercer_lugar", false)
    .maybeSingle();
  if (finalReadError) throw new Error(`leer final: ${finalReadError.message}`);
  if (!finalRow) throw new Error("La final no se generó tras jugar ambas semifinales.");

  console.log(
    `\n=== Final ===\n${nombrePorParticipant[finalRow.participant1_id]} vs ${
      nombrePorParticipant[finalRow.participant2_id]
    } -- formato_partido=${finalRow.formato_partido} (esperado: bo5)`
  );

  if (finalRow.status !== "jugado") {
    const { error } = await sb.rpc("reportar_resultado", {
      p_match_id: finalRow.id,
      p_ganador_id: finalRow.participant1_id,
    });
    if (error) throw new Error(`reportar final: ${error.message}`);
    console.log(`Final jugada: ganó ${nombrePorParticipant[finalRow.participant1_id]}.`);
  }

  const { data: torneoFinal, error: torneoFinalError } = await sb
    .from("tournaments")
    .select("estado, campeon_participant_id")
    .eq("id", TORNEO_ID)
    .single();
  if (torneoFinalError) throw new Error(`leer torneo final: ${torneoFinalError.message}`);

  console.log(
    `\nTorneo estado final: ${torneoFinal.estado} -- campeón: ${
      nombrePorParticipant[torneoFinal.campeon_participant_id] ?? "?"
    }`
  );
  console.log("\n=== FIN DE LA CONTINUACIÓN ===");
}

main().catch((err) => {
  console.error("\nFALLÓ:", err.message);
  process.exit(1);
});
