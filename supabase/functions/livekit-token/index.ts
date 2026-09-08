// Delfin Mode -- voz en tiempo real (LiveKit). Esta función Edge es la
// ÚNICA pieza que conoce el API secret de LiveKit: genera un token de
// acceso temporal (JWT) por usuario y por sala, y se lo devuelve al
// navegador -- el secret nunca viaja al cliente.
//
// Se despliega desde el Dashboard de Supabase (Edge Functions -> New
// Function -> pegar este archivo) o con el CLI (`supabase functions
// deploy livekit-token`). LIVEKIT_API_KEY y LIVEKIT_API_SECRET se
// configuran como "secrets" de esta función (Dashboard: Edge
// Functions -> livekit-token -> Secrets, o `supabase secrets set`) --
// NUNCA en el .env del frontend. SUPABASE_URL y SUPABASE_ANON_KEY ya
// vienen provistas automáticamente por el runtime de Supabase, no hace
// falta configurarlas a mano.
//
// Todavía sin credenciales reales de LiveKit -- este archivo está
// listo para desplegarse, pero no se pudo probar contra un servidor
// real. Ver las instrucciones de la cuenta de LiveKit en el chat.
import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function respuestaJson(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return respuestaJson({ error: "Método no permitido." }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return respuestaJson({ error: "Falta autenticación." }, 401);
  }

  // Cliente "en nombre del usuario que llama" -- reenvía su propio JWT,
  // así que auth.getUser() y las consultas de abajo quedan sujetas al
  // RLS real del proyecto, exactamente como si las hiciera el propio
  // navegador.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return respuestaJson({ error: "Sesión inválida." }, 401);
  }
  const usuario = userData.user;

  let teamId: string | undefined;
  try {
    const cuerpo = await req.json();
    teamId = cuerpo?.teamId;
  } catch {
    return respuestaJson({ error: "Cuerpo de la solicitud inválido." }, 400);
  }
  if (!teamId) {
    return respuestaJson({ error: "Falta teamId." }, 400);
  }

  // Mismo límite que la política RLS de mensajes_equipo (migración
  // 071): un usuario solo puede pedir un token para el canal de voz de
  // SU PROPIO equipo, nunca el de otro -- team_members.user_id es la
  // primary key de esa tabla, así que esta consulta trae como máximo
  // una fila.
  const { data: membresia } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", usuario.id)
    .maybeSingle();

  if (!membresia || membresia.team_id !== teamId) {
    return respuestaJson({ error: "No perteneces a ese equipo." }, 403);
  }

  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!apiKey || !apiSecret) {
    return respuestaJson({ error: "La integración de voz todavía no está configurada." }, 503);
  }

  const { data: perfil } = await supabase
    .from("profiles")
    .select("nick, unique_id")
    .eq("id", usuario.id)
    .single();

  const nombreVisible = perfil?.nick ? `${perfil.nick}#${perfil.unique_id}` : "Jugador de RemorApp";
  // Una sala de LiveKit por equipo -- misma granularidad que el chat
  // de texto (mensajes_equipo.team_id).
  const nombreSala = `equipo-${teamId}`;

  const token = new AccessToken(apiKey, apiSecret, {
    identity: usuario.id,
    name: nombreVisible,
    ttl: "4h",
  });
  token.addGrant({
    room: nombreSala,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  return respuestaJson({ token: await token.toJwt(), room: nombreSala });
});
