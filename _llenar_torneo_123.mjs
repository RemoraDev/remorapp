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
const TORNEO_ID = "de7132fb-a704-4d6f-b51b-516431e4cb50";

const cuentas = [];
for (let i = 1; i <= 5; i++) {
  const nick = `Todos${i}`; // corto, dentro del límite de 3-13 caracteres.
  const email = `remorapp.qa.todos${i}.${now}@mailinator.com`;
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signUp({ email, password: PASSWORD });
  if (error) {
    console.error(`Error creando ${nick}:`, error.message);
    continue;
  }
  const userId = data.user.id;
  const { error: nickError } = await supabase.from("profiles").update({ nick }).eq("id", userId);
  if (nickError) console.error(`Error poniendo nick a ${nick}:`, nickError.message);

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
  "_torneo_123_ficticios.json",
  JSON.stringify({ torneoId: TORNEO_ID, cuentas: cuentas.map((c) => ({ email: c.email, userId: c.userId, nick: c.nick })) }, null, 2)
);

console.log(`\nListo -- ${cuentas.length} jugadores ficticios inscritos en el torneo 123.`);
