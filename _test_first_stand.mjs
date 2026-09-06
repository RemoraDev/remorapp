import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://nvbvhengpvappqzailtc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_elKrBmtuHtrNS1K8m6beXg_R7CWo4WE";
const PASSWORD = "PruebaRemor2026!";
const TS = Date.now().toString().slice(-6);

function cliente() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function crearCuenta(emailLocal, nick) {
  const sb = cliente();
  const email = `${emailLocal}.${TS}@mailinator.com`;
  const { data, error } = await sb.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp ${email}: ${error.message}`);
  let userId = data.user?.id;
  let session = data.session;

  if (!session) {
    const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`signIn ${email}: ${signInError.message}`);
    session = signInData.session;
    userId = signInData.user.id;
  }

  const { error: perfilError } = await sb
    .from("profiles")
    .update({ nick, country: "chile", sc2_region: "america", sc2_id: `TestID${nick}` })
    .eq("id", userId);
  if (perfilError) throw new Error(`perfil ${email}: ${perfilError.message}`);

  return { sb, email, userId };
}

async function main() {
  console.log("=== Creando cuentas de prueba ===");
  const organizador = await crearCuenta("remorapp.qa.firststand.org", `FSOrg${TS.slice(-3)}`);
  console.log("Organizador:", organizador.email);

  const equipos = [];
  const letras = ["A", "B", "C", "D", "E", "F", "G"];
  for (let i = 0; i < 7; i++) {
    const letra = letras[i];
    const owner = await crearCuenta(`remorapp.qa.firststand.t${i + 1}.owner`, `FST${letra}Own${TS.slice(-2)}`);
    const miembro2 = await crearCuenta(`remorapp.qa.firststand.t${i + 1}.m2`, `FST${letra}M2${TS.slice(-2)}`);

    const { data: team, error: teamError } = await owner.sb
      .from("teams")
      .insert({
        name: `First Stand ${letra}`,
        tag: `FS${letra}${letra}`,
        sc2_regions: ["america"],
        is_public: true,
        owner_id: owner.userId,
      })
      .select()
      .single();
    if (teamError) throw new Error(`crear equipo ${letra}: ${teamError.message}`);

    const { error: joinError } = await miembro2.sb
      .from("team_members")
      .insert({ user_id: miembro2.userId, team_id: team.id, roles: ["jugador"] });
    if (joinError) throw new Error(`unir miembro2 equipo ${letra}: ${joinError.message}`);

    equipos.push({ letra, owner, miembro2, teamId: team.id, teamName: team.name });
    console.log(`Equipo ${letra} creado: ${team.name} (${team.id}), 2 miembros.`);
  }

  console.log("\n=== Creando torneo First Stand ===");
  const fechaInicio = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data: torneo, error: torneoError } = await organizador.sb
    .from("tournaments")
    .insert({
      nombre: `First Stand QA ${TS}`,
      formato: "2v2",
      modo: "eliminacion_simple",
      publico: false,
      cupos_totales: 7,
      fecha_inicio: fechaInicio,
      creador_id: organizador.userId,
      formato_liga: "first_stand",
      puntos_victoria_2_1: 3,
    })
    .select()
    .single();
  if (torneoError) throw new Error(`crear torneo: ${torneoError.message}`);
  console.log("Torneo creado:", torneo.id, torneo.nombre);

  console.log("\n=== Inscribiendo los 7 equipos (organizador_inscribir_equipo) ===");
  for (const eq of equipos) {
    const { error } = await organizador.sb.rpc("organizador_inscribir_equipo", {
      p_tournament_id: torneo.id,
      p_team_id: eq.teamId,
    });
    if (error) throw new Error(`inscribir equipo ${eq.letra}: ${error.message}`);
    console.log(`Equipo ${eq.letra} inscrito.`);
  }

  console.log("\n=== Abriendo check-in ===");
  const { error: checkInError } = await organizador.sb
    .from("tournaments")
    .update({ check_in_abierto: true })
    .eq("id", torneo.id);
  if (checkInError) throw new Error(`abrir check-in: ${checkInError.message}`);

  console.log("\n=== Confirmando asistencia de los 7 equipos ===");
  const { data: participantes, error: partError } = await organizador.sb
    .from("tournament_participants")
    .select("id, team_id")
    .eq("tournament_id", torneo.id);
  if (partError) throw new Error(`leer participantes: ${partError.message}`);

  const participantIdPorTeam = Object.fromEntries(participantes.map((p) => [p.team_id, p.id]));
  for (const eq of equipos) {
    const participantId = participantIdPorTeam[eq.teamId];
    const { error } = await eq.owner.sb.rpc("confirmar_asistencia", { p_participant_id: participantId });
    if (error) throw new Error(`confirmar asistencia equipo ${eq.letra}: ${error.message}`);
  }
  console.log("Los 7 equipos confirmaron asistencia.");

  console.log("\n=== Generando fixture First Stand (Berger) ===");
  const { error: fixtureError } = await organizador.sb.rpc("generar_fixture_first_stand", {
    p_tournament_id: torneo.id,
  });
  if (fixtureError) throw new Error(`generar fixture: ${fixtureError.message}`);
  console.log("Fixture generado.");

  console.log("\n=== Verificando el fixture ===");
  const { data: grupos } = await organizador.sb
    .from("tournament_groups")
    .select("id")
    .eq("tournament_id", torneo.id);
  const grupoId = grupos[0].id;

  const { data: partidas, error: partidasError } = await organizador.sb
    .from("tournament_group_matches")
    .select("id, participant1_id, participant2_id, jornada")
    .eq("group_id", grupoId)
    .order("jornada");
  if (partidasError) throw new Error(`leer partidas: ${partidasError.message}`);

  console.log(`Total de partidos generados: ${partidas.length} (esperado: 21)`);

  const jornadas = [...new Set(partidas.map((p) => p.jornada))].sort((a, b) => a - b);
  console.log(`Jornadas: ${jornadas.join(", ")} (esperado: 1,2,3,4,5,6,7)`);

  const porJornada = {};
  for (const p of partidas) {
    porJornada[p.jornada] = (porJornada[p.jornada] ?? 0) + 1;
  }
  console.log("Partidos por jornada:", porJornada);

  const paresVistos = new Set();
  let repetidos = 0;
  for (const p of partidas) {
    const clave = [p.participant1_id, p.participant2_id].sort().join("|");
    if (paresVistos.has(clave)) repetidos++;
    paresVistos.add(clave);
  }
  console.log(`Pares únicos: ${paresVistos.size} (esperado: 21) -- pares repetidos: ${repetidos} (esperado: 0)`);

  const conteoPorEquipo = {};
  for (const p of partidas) {
    conteoPorEquipo[p.participant1_id] = (conteoPorEquipo[p.participant1_id] ?? 0) + 1;
    conteoPorEquipo[p.participant2_id] = (conteoPorEquipo[p.participant2_id] ?? 0) + 1;
  }
  const partidosPorEquipo = Object.values(conteoPorEquipo);
  console.log(
    "Partidos jugados por cada equipo:",
    partidosPorEquipo,
    "(esperado: todos en 6, ya que cada equipo enfrenta a los otros 6 una vez)"
  );

  console.log("\n=== Reportando los 21 partidos de grupo ===");
  const nombrePorParticipant = {};
  for (const eq of equipos) nombrePorParticipant[participantIdPorTeam[eq.teamId]] = eq.letra;

  let indice = 0;
  for (const p of partidas) {
    const resultadoPerdedor = indice % 2 === 0 ? 0 : 1;
    const { error } = await organizador.sb.rpc("reportar_resultado_grupo", {
      p_match_id: p.id,
      p_ganador_id: p.participant1_id,
      p_resultado_perdedor: resultadoPerdedor,
    });
    if (error) throw new Error(`reportar partido ${p.id}: ${error.message}`);
    indice++;
  }
  console.log(`Los ${partidas.length} partidos fueron reportados (alternando victorias 2-0 y 2-1).`);

  console.log("\n=== Tabla de posiciones (posiciones_grupos) ===");
  const { data: posiciones, error: posicionesError } = await organizador.sb.rpc("posiciones_grupos", {
    p_tournament_id: torneo.id,
  });
  if (posicionesError) throw new Error(`posiciones_grupos: ${posicionesError.message}`);
  for (const pos of posiciones) {
    console.log(
      `  ${nombrePorParticipant[pos.participant_id]}: ganados=${pos.ganados} jugados=${pos.jugados} puntos=${pos.puntos} dif_mapas=${pos.dif_mapas}`
    );
  }

  console.log("\n=== Generando playoffs (generar_llave) ===");
  const { error: llaveError } = await organizador.sb.rpc("generar_llave", { p_tournament_id: torneo.id });
  if (llaveError) throw new Error(`generar_llave: ${llaveError.message}`);
  console.log("Playoffs generados.");

  const { data: bracket, error: bracketError } = await organizador.sb
    .from("bracket_matches")
    .select("id, round, match_number, participant1_id, participant2_id, formato_partido, es_tercer_lugar")
    .eq("tournament_id", torneo.id)
    .order("round")
    .order("match_number");
  if (bracketError) throw new Error(`leer bracket: ${bracketError.message}`);

  console.log("\n=== Llave de playoffs ===");
  for (const m of bracket) {
    console.log(
      `  Ronda ${m.round} #${m.match_number}: ${nombrePorParticipant[m.participant1_id] ?? "?"} vs ${
        nombrePorParticipant[m.participant2_id] ?? "?"
      } -- formato_partido=${m.formato_partido}`
    );
  }

  const semifinal1 = bracket.find((m) => m.round === 1 && m.match_number === 1);
  const semifinal2 = bracket.find((m) => m.round === 1 && m.match_number === 2);
  const final = bracket.find((m) => m.round === 2 && !m.es_tercer_lugar);

  console.log(
    `\nSemifinal 1 (esperado 1° vs 4°): ${nombrePorParticipant[semifinal1.participant1_id]} vs ${
      nombrePorParticipant[semifinal1.participant2_id]
    }`
  );
  console.log(
    `Semifinal 2 (esperado 2° vs 3°): ${nombrePorParticipant[semifinal2.participant1_id]} vs ${
      nombrePorParticipant[semifinal2.participant2_id]
    }`
  );
  console.log(`Final formato_partido: ${final.formato_partido} (esperado: bo5)`);

  console.log("\n=== Jugando las semifinales y la final ===");
  const { error: sf1Error } = await organizador.sb.rpc("reportar_resultado", {
    p_match_id: semifinal1.id,
    p_ganador_id: semifinal1.participant1_id,
  });
  if (sf1Error) throw new Error(`reportar semifinal 1: ${sf1Error.message}`);

  const { error: sf2Error } = await organizador.sb.rpc("reportar_resultado", {
    p_match_id: semifinal2.id,
    p_ganador_id: semifinal2.participant1_id,
  });
  if (sf2Error) throw new Error(`reportar semifinal 2: ${sf2Error.message}`);

  const { data: bracketTrasSemis } = await organizador.sb
    .from("bracket_matches")
    .select("id, round, match_number, participant1_id, participant2_id, formato_partido")
    .eq("tournament_id", torneo.id)
    .eq("round", 2)
    .eq("es_tercer_lugar", false)
    .single();

  console.log(
    `Final tras semifinales: ${nombrePorParticipant[bracketTrasSemis.participant1_id]} vs ${
      nombrePorParticipant[bracketTrasSemis.participant2_id]
    } -- formato_partido=${bracketTrasSemis.formato_partido}`
  );

  const { error: finalError } = await organizador.sb.rpc("reportar_resultado", {
    p_match_id: bracketTrasSemis.id,
    p_ganador_id: bracketTrasSemis.participant1_id,
  });
  if (finalError) throw new Error(`reportar final: ${finalError.message}`);

  const { data: torneoFinal } = await organizador.sb
    .from("tournaments")
    .select("estado, campeon_participant_id")
    .eq("id", torneo.id)
    .single();

  console.log(
    `\nTorneo estado final: ${torneoFinal.estado} -- campeón: ${
      nombrePorParticipant[torneoFinal.campeon_participant_id] ?? "?"
    }`
  );

  console.log(`\nID del torneo para revisión manual en la UI: ${torneo.id}`);
  console.log("\n=== FIN DE LA PRUEBA ===");
}

main().catch((err) => {
  console.error("\nFALLÓ:", err.message);
  process.exit(1);
});
