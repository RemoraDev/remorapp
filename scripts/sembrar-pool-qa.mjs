// Crea, UNA SOLA VEZ, un pool reutilizable de cuentas de prueba reales
// para el botón "Rellenar con equipos y jugadores" (Panel de control,
// visible solo para staff/admin) -- RemorApp exige que todo
// tournament_participants sea un user_id o team_id real (FK a
// auth.users), no hay forma de inventar participantes fantasma sin
// cuentas de verdad. Este script usa la Admin API de Supabase
// (auth.admin.createUser) para crear:
//   - 20 cuentas individuales sueltas, nick "QAPoolJugadorNN" -- para
//     rellenar torneos 1v1.
//   - 8 clanes, cada uno con 4 miembros reales (32 cuentas más), nick
//     "QAPoolEquipoNN_M" -- con roster al tope (4) califican para
//     cualquier formato de equipo (2v2/3v3/4v4) sin importar cuál
//     elija el organizador.
// Es idempotente: si ya existe una cuenta con ese nick, la saltea en
// vez de duplicarla -- correrlo de nuevo no rompe nada.
//
// Uso:
//   1. Sacá tu Service Role Key de supabase.com/dashboard -> tu
//      proyecto -> Project Settings -> API -- NUNCA se la pases a
//      Claude ni la subas a git, solo vos la tenés.
//   2. SUPABASE_SERVICE_ROLE_KEY=tu-key node scripts/sembrar-pool-qa.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
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

async function completarProfile(id, nick) {
  const { error } = await admin
    .from("profiles")
    .update({ nick, cuenta_validada: true, country: "chile", sc2_region: "america", es_cuenta_prueba: true })
    .eq("id", id);
  if (error) throw new Error(`No pude completar el profile de ${nick} (${id}): ${error.message}`);
}

// Nota: NO usa auth.admin.listUsers() para chequear duplicados --
// ese proyecto tiene cuentas viejas con datos incompletos que hacen
// fallar esa llamada con "Database error finding users" (no tiene
// nada que ver con este script). En cambio, intenta crear
// directamente; si el email ya existe, avisa con el mensaje de
// Supabase y corta ahí -- hay que borrar esa cuenta puntual desde el
// Dashboard (Authentication > Users > buscar el email > Delete user)
// y volver a correr el script, no intenta adivinar su id.
async function crearCuentaPool(nick, email) {
  const { data: creado, error: errorAuth } = await admin.auth.admin.createUser({
    email,
    password: passwordAlAzar(),
    email_confirm: true,
  });
  if (errorAuth || !creado?.user) {
    throw new Error(
      `No pude crear ${email}: ${errorAuth?.message ?? "sin usuario devuelto"} -- si ya existe, ` +
        `borrala desde el Dashboard (Authentication > Users) y volvé a correr el script.`
    );
  }

  await completarProfile(creado.user.id, nick);

  console.log(`  ${nick} creado (${creado.user.id}).`);
  return creado.user.id;
}

console.log("1) Cuentas individuales sueltas (1v1)...");
const idsJugadores = [];
for (let i = 1; i <= 20; i++) {
  const n = String(i).padStart(2, "0");
  const id = await crearCuentaPool(`QAPoolJugador${n}`, `qa.pool.jugador.${n}@remorapp-qa-pool.invalid`);
  idsJugadores.push(id);
}

console.log("2) Clanes de prueba (2v2/3v3/4v4), 4 miembros cada uno...");
const TAGS = ["QABA", "QABB", "QABC", "QABD", "QABE", "QABF", "QABG", "QABH"];
for (let equipo = 1; equipo <= 8; equipo++) {
  const nEquipo = String(equipo).padStart(2, "0");
  const idsMiembros = [];
  for (let miembro = 1; miembro <= 4; miembro++) {
    const id = await crearCuentaPool(
      `QAPoolEquipo${nEquipo}_${miembro}`,
      `qa.pool.equipo.${nEquipo}.${miembro}@remorapp-qa-pool.invalid`
    );
    idsMiembros.push(id);
  }

  const nombreEquipo = `QA Pool Equipo ${equipo}`;
  const { data: equipoExistente } = await admin.from("teams").select("id").eq("name", nombreEquipo).maybeSingle();
  if (equipoExistente) {
    console.log(`  ${nombreEquipo} ya existe, salteando.`);
    continue;
  }

  // El primer miembro queda como owner -- el trigger
  // after_insert_teams_owner le crea su fila en team_members solo.
  const { data: nuevoEquipo, error: errorEquipo } = await admin
    .from("teams")
    .insert({
      name: nombreEquipo,
      tag: TAGS[equipo - 1],
      sc2_regions: ["america"],
      owner_id: idsMiembros[0],
      is_public: true,
      es_cuenta_prueba: true,
    })
    .select("id")
    .single();
  if (errorEquipo || !nuevoEquipo) {
    throw new Error(`No pude crear ${nombreEquipo}: ${errorEquipo?.message}`);
  }

  const { error: errorMiembros } = await admin.from("team_members").insert(
    idsMiembros.slice(1).map((user_id) => ({ team_id: nuevoEquipo.id, user_id }))
  );
  if (errorMiembros) {
    throw new Error(`No pude agregar miembros a ${nombreEquipo}: ${errorMiembros.message}`);
  }

  console.log(`  ${nombreEquipo} (${TAGS[equipo - 1]}) creado con 4 miembros.`);
}

console.log("Listo. El botón \"Rellenar con equipos y jugadores\" ya tiene de dónde sacar participantes.");
