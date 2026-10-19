// Crea, UNA SOLA VEZ, un pool reutilizable de cuentas de prueba reales
// para el botón "Rellenar con equipos y jugadores" (Panel de control,
// visible solo para staff/admin) -- RemorApp exige que todo
// tournament_participants sea un user_id o team_id real (FK a
// auth.users), no hay forma de inventar participantes fantasma sin
// cuentas de verdad.
//
// Este proyecto en particular rechaza "permission denied for table
// profiles/teams/..." al hacer operaciones normales de tabla con la
// Service Role Key (algo específico de este proyecto, no de este
// script -- la Admin API de Auth sí funciona bien con la misma key).
// Por eso el script SOLO usa auth.admin.createUser() -- lo único que
// confirmamos que funciona -- para crear las 52 cuentas en
// auth.users, y al final IMPRIME un bloque de SQL con los IDs reales
// para que lo corras vos en el SQL Editor (que al ser superusuario no
// tiene este problema) y complete profiles/teams/team_members.
//
// Uso:
//   1. Sacá tu Service Role Key de supabase.com/dashboard -> tu
//      proyecto -> Project Settings -> API -- NUNCA se la pases a
//      Claude ni la subas a git, solo vos la tenés.
//   2. SUPABASE_SERVICE_ROLE_KEY=tu-key node scripts/sembrar-pool-qa.mjs
//   3. Copiá el bloque SQL que imprime al final y corrélo en el SQL
//      Editor de Supabase.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, "..");

function leerUrlDesdeEnv() {
  try {
    const env = readFileSync(join(RAIZ, ".env"), "utf8");
    const match = env.match(/^VITE_SUPABASE_URL=(.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || leerUrlDesdeEnv();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error("No encontré VITE_SUPABASE_URL en .env ni SUPABASE_URL en el entorno.");
  process.exit(1);
}
if (!SERVICE_ROLE_KEY) {
  console.error(
    "Falta SUPABASE_SERVICE_ROLE_KEY. Sacala de supabase.com/dashboard -> tu proyecto -> " +
      "Project Settings -> API, y corré: SUPABASE_SERVICE_ROLE_KEY=tu-key node scripts/sembrar-pool-qa.mjs"
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function passwordAlAzar() {
  return "QaPool-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function sqlString(valor) {
  return "'" + valor.replace(/'/g, "''") + "'";
}

// Crea la cuenta en auth.users -- si el email ya existe (de un
// intento anterior), lo informa y corta: borrala desde el Dashboard
// (Authentication > Users > buscar el email > Delete user) y volvé a
// correr el script.
async function crearCuentaAuth(email) {
  const { data: creado, error } = await admin.auth.admin.createUser({
    email,
    password: passwordAlAzar(),
    email_confirm: true,
  });
  if (error || !creado?.user) {
    throw new Error(
      `No pude crear ${email}: ${error?.message ?? "sin usuario devuelto"} -- si ya existe, ` +
        `borrala desde el Dashboard (Authentication > Users) y volvé a correr el script.`
    );
  }
  return creado.user.id;
}

console.log("1) Cuentas individuales sueltas (1v1)...");
const jugadores = [];
for (let i = 1; i <= 20; i++) {
  const n = String(i).padStart(2, "0");
  const nick = `QAPoolJugador${n}`;
  const id = await crearCuentaAuth(`qa.pool.jugador.${n}@remorapp-qa-pool.invalid`);
  jugadores.push({ nick, id });
  console.log(`  ${nick} creado (${id}).`);
}

console.log("2) Cuentas para clanes de prueba (2v2/3v3/4v4), 4 por clan...");
const TAGS = ["QABA", "QABB", "QABC", "QABD", "QABE", "QABF", "QABG", "QABH"];
const equipos = [];
for (let equipo = 1; equipo <= 8; equipo++) {
  const nEquipo = String(equipo).padStart(2, "0");
  const miembros = [];
  for (let miembro = 1; miembro <= 4; miembro++) {
    const nick = `QAPoolEquipo${nEquipo}_${miembro}`;
    const id = await crearCuentaAuth(`qa.pool.equipo.${nEquipo}.${miembro}@remorapp-qa-pool.invalid`);
    miembros.push({ nick, id });
    console.log(`  ${nick} creado (${id}).`);
  }
  equipos.push({ nombre: `QA Pool Equipo ${equipo}`, tag: TAGS[equipo - 1], miembros });
}

// ---- Arma el bloque SQL con los IDs reales ----
const lineasProfiles = [];
for (const j of jugadores) {
  lineasProfiles.push(
    `update public.profiles set nick = ${sqlString(j.nick)}, cuenta_validada = true, country = 'chile', sc2_region = 'america', es_cuenta_prueba = true where id = '${j.id}';`
  );
}
for (const eq of equipos) {
  for (const m of eq.miembros) {
    lineasProfiles.push(
      `update public.profiles set nick = ${sqlString(m.nick)}, cuenta_validada = true, country = 'chile', sc2_region = 'america', es_cuenta_prueba = true where id = '${m.id}';`
    );
  }
}

const lineasEquipos = [];
for (const eq of equipos) {
  const owner = eq.miembros[0];
  const resto = eq.miembros.slice(1);
  lineasEquipos.push(
    `insert into public.teams (name, tag, sc2_regions, owner_id, is_public, es_cuenta_prueba) values (${sqlString(
      eq.nombre
    )}, ${sqlString(eq.tag)}, array['america'], '${owner.id}', true, true);`
  );
  for (const m of resto) {
    lineasEquipos.push(
      `insert into public.team_members (team_id, user_id) select id, '${m.id}' from public.teams where name = ${sqlString(
        eq.nombre
      )};`
    );
  }
}

const sqlFinal = [
  "-- Corré esto en el SQL Editor de Supabase para terminar de armar el pool --",
  "-- generado por scripts/sembrar-pool-qa.mjs, con los IDs reales ya creados.",
  "",
  "-- 1) Completa nick/validación de las 52 cuentas:",
  ...lineasProfiles,
  "",
  "-- 2) Crea los 8 clanes y agrega a sus otros 3 miembros cada uno",
  "--    (el dueño ya queda de owner_id, el trigger lo agrega solo a team_members):",
  ...lineasEquipos,
  "",
].join("\n");

const rutaSalida = join(RAIZ, "pool-qa-completar.sql");
writeFileSync(rutaSalida, sqlFinal, "utf8");

console.log("\nListo. Las 52 cuentas ya existen en auth.users.");
console.log(`Ahora corré el SQL que quedó en ${rutaSalida} en el SQL Editor de Supabase para terminar.`);
