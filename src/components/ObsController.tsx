import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import { conectarObs, EVENTO_OBS_CONFIG_ACTUALIZADA } from "../lib/obsWebsocket";
import type { ConexionObs } from "../lib/obsWebsocket";

type EstadoObs = "inactivo" | "conectando" | "conectado" | "error";

// Control remoto de OBS (migración 103): mientras el caster tenga esta
// pestaña abierta, en cualquier página de la app, abre y mantiene una
// conexión obs-websocket hacia SU PROPIO OBS (nunca hacia el de otra
// persona -- obtener_config_obs() solo devuelve la fila de quien
// llama) y le cambia la escena sola cuando cambia el estado de una
// Clan War de su equipo. Se monta una única vez en App.tsx, junto al
// resto de los proveedores globales.
//
// No hace nada visible salvo el indicador de estado, y ese indicador
// solo aparece si el propio usuario logueado tiene la configuración de
// OBS completa -- para cualquier otra persona este componente no
// renderiza nada.
export default function ObsController() {
  const { user, profile } = useAuth();
  const [estado, setEstado] = useState<EstadoObs>("inactivo");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const conexionRef = useRef<ConexionObs | null>(null);
  // Se incrementa cada vez que ProfilePage guarda o borra la config de
  // OBS -- hace falta como disparador aparte porque la contraseña
  // nunca viaja en el objeto "profile" (ver EVENTO_OBS_CONFIG_ACTUALIZADA
  // en obsWebsocket.ts): cambiar solo la contraseña no modifica
  // ninguno de los campos de los que depende el efecto de conexión.
  const [recargas, setRecargas] = useState(0);

  useEffect(() => {
    const escuchar = () => setRecargas((n) => n + 1);
    window.addEventListener(EVENTO_OBS_CONFIG_ACTUALIZADA, escuchar);
    return () => window.removeEventListener(EVENTO_OBS_CONFIG_ACTUALIZADA, escuchar);
  }, []);

  const configCompleta = !!(
    profile?.obs_websocket_url &&
    profile?.obs_escena_bracket &&
    profile?.obs_escena_en_vivo
  );

  // Abre (o cierra) la conexión con OBS cuando cambia la configuración
  // guardada o el usuario logueado.
  useEffect(() => {
    let cancelado = false;

    conexionRef.current?.cerrar();
    conexionRef.current = null;

    if (!user || !configCompleta) {
      setEstado("inactivo");
      setErrorMsg(null);
      return;
    }

    setEstado("conectando");
    setErrorMsg(null);

    supabase.rpc("obtener_config_obs").then(({ data, error }) => {
      if (cancelado) return;

      const fila = Array.isArray(data) ? data[0] : data;
      if (error || !fila?.obs_websocket_url || !fila?.obs_websocket_password) {
        setEstado("error");
        setErrorMsg(error?.message ?? "Falta la contraseña de OBS guardada.");
        return;
      }

      conectarObs(fila.obs_websocket_url, fila.obs_websocket_password, () => {
        // OBS se cerró, se reinició, o se cayó la red -- se avisa en
        // el indicador, sin reintentar solo (evita reintentos en
        // bucle si OBS quedó apagado).
        if (!cancelado) {
          conexionRef.current = null;
          setEstado("error");
          setErrorMsg("Se perdió la conexión con OBS.");
        }
      })
        .then((conexion) => {
          if (cancelado) {
            conexion.cerrar();
            return;
          }
          conexionRef.current = conexion;
          setEstado("conectado");
        })
        .catch((err: Error) => {
          if (cancelado) return;
          setEstado("error");
          setErrorMsg(err.message);
        });
    });

    return () => {
      cancelado = true;
      conexionRef.current?.cerrar();
      conexionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, configCompleta, recargas]);

  // A qué equipo pertenece el caster logueado -- team_members.user_id
  // es la primary key de esa tabla, así que como máximo hay uno.
  useEffect(() => {
    if (!user) {
      setTeamId(null);
      return;
    }
    let cancelado = false;
    obtenerEquipoDelUsuario(user.id).then((equipo) => {
      if (!cancelado) setTeamId(equipo?.team_id ?? null);
    });
    return () => {
      cancelado = true;
    };
  }, [user]);

  // Dispara el cambio de escena cuando cambia el estado de una Clan
  // War del equipo del caster. Nota de alcance: clan_wars_select_propio
  // en la base solo deja ver la fila al capitán o dueño del equipo --
  // un jugador raso no recibe este evento (ver el comentario largo en
  // migration_103_control_remoto_obs.sql).
  useEffect(() => {
    if (!teamId || !profile?.obs_escena_en_vivo || !profile?.obs_escena_bracket) return;

    const escenaEnVivo = profile.obs_escena_en_vivo;
    const escenaBracket = profile.obs_escena_bracket;

    const intentarCambiarEscena = (escena: string) => {
      conexionRef.current?.cambiarEscena(escena).catch(() => {
        // Si OBS rechaza el pedido (por ejemplo, esa escena no existe
        // con ese nombre exacto), no hay más que intentar automático
        // -- el indicador de más abajo sigue reflejando la conexión.
      });
    };

    const manejarCambioClanWar = (payload: {
      old: { status?: string };
      new: { status?: string };
    }) => {
      const anterior = payload.old?.status;
      const actual = payload.new?.status;
      if (actual === "en_curso" && anterior !== "en_curso") {
        intentarCambiarEscena(escenaEnVivo);
      } else if ((actual === "finalizada" || actual === "empatada") && anterior !== actual) {
        intentarCambiarEscena(escenaBracket);
      }
    };

    const manejarPartidaResuelta = (payload: { new: { status?: string } }) => {
      // Cualquier fila que llegue a 'jugado' es una partida individual
      // recién resuelta -- se muestra la escena de bracket/marcador
      // hasta que el propio caster vuelva a cambiar a la de en vivo.
      if (payload.new?.status === "jugado") {
        intentarCambiarEscena(escenaBracket);
      }
    };

    const channel = supabase
      .channel(`obs-clan-wars-${teamId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "clan_wars", filter: `challenger_team_id=eq.${teamId}` },
        manejarCambioClanWar
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "clan_wars", filter: `challenged_team_id=eq.${teamId}` },
        manejarCambioClanWar
      )
      .subscribe();

    // Partidas individuales (migración 090/042): no se puede filtrar
    // por equipo directo (clan_war_matches/clan_war_wtl_sets solo
    // tienen clan_war_id) -- se escuchan todas y se descartan las que
    // no correspondan a este equipo comparando contra la lista de
    // Clan Wars ya vistas no hace falta: alcanza con que la propia RLS
    // de esas tablas ya solo deja pasar las del equipo del capitán/dueño
    // que está mirando.
    const channelPartidas = supabase
      .channel(`obs-partidas-${teamId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "clan_war_matches" }, manejarPartidaResuelta)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "clan_war_wtl_sets" }, manejarPartidaResuelta)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(channelPartidas);
    };
  }, [teamId, profile?.obs_escena_en_vivo, profile?.obs_escena_bracket]);

  if (estado === "inactivo") return null;

  return (
    <div className={`obs-indicador obs-indicador-${estado}`}>
      {estado === "conectando" && "● Conectando a OBS..."}
      {estado === "conectado" && "● Conectado a OBS"}
      {estado === "error" && `● No conectado a OBS${errorMsg ? ` -- ${errorMsg}` : ""}`}
    </div>
  );
}
