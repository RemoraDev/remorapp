import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const PASSWORD = "PruebaRemor2026!";
const now = Date.now();
const TORNEO_ID = "e0da05b9-d416-4e83-b3b5-b8c985cf05e9";

const cuentas = [];
for (let i = 1; i <= 15; i++) {
  const nick = `JugadorFicticio${i}`;
  const email = `remorapp.qa.ficticio${i}.${now}@mailinator.com`;
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signUp({ email, password: PASSWORD });
  if (error) {
    console.error(`Error creando ${nick}:`, error.message);
    continue;
  }
  const userId = data.user.id;
  await supabase
    .from("profiles")
    .update({ nick, country: "chile", sc2_region: "america", sc2_id: `${nick}#0000` })
    .eq("id", userId);

  const { error: inscribirError } = await supabase
    .from("tournament_participants")
    .insert({ tournament_id: TORNEO_ID, user_id: userId });

  if (inscribirError) {
    console.error(`Error inscribiendo a ${nick}:`, inscribirError.message);
    continue;
  }

  cuentas.push({ email, userId, nick, supabase });
  console.log(`Inscrito: ${nick}`);
}

fs.writeFileSync(
  "_torneo_122_ficticios.json",
  JSON.stringify(
    { torneoId: TORNEO_ID, cuentas: cuentas.map((c) => ({ email: c.email, userId: c.userId, nick: c.nick })) },
    null,
    2
  )
);

console.log(`\nListo -- ${cuentas.length} jugadores ficticios inscritos en el torneo 122.`);
