import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { validarNick } from "../lib/nickValidation";
import { recortarImagenConProporcion, recortarImagenCuadrada } from "../lib/teams";
import { formatFecha } from "../lib/formatters";
import { COUNTRY_OPTIONS, LIGA_OPTIONS, SC2_REGION_OPTIONS, perfilEstaCompleto } from "../types/profile";
import type { AvatarForma, Country, Liga, LinkTransmision, Sc2Region, Profile } from "../types/profile";
import { RAZA_SC2_OPTIONS } from "../types/juegos";
import type { DatosSc2, RazaSc2 } from "../types/juegos";
import { obtenerJuegoIdSc2 } from "../lib/juegos";
import type { SkinAvatar } from "../types/skins";
import Avatar from "../components/Avatar";
import AvatarSkin from "../components/AvatarSkin";
import TitulosActivosList from "../components/TitulosActivosList";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const BANNER_MAX_BYTES = 3 * 1024 * 1024;

interface InvitacionConEquipo {
  id: string;
  equipoNombre: string;
  equipoTag: string;
  equipoLogoUrl: string | null;
  invitadoPorNick: string | null;
}

interface JugadorEncontrado {
  id: string;
  nick: string;
  uniqueId: string;
}

interface TituloJugadorConNombre {
  id: string;
  retadorId: string;
  retadorNombre: string;
  retadoId: string;
  retadoNombre: string;
  duracionDias: number;
  aceptado: boolean;
}

// Gestor de eventos de títulos (migración 048): un título Padre/Hijo
// ya resuelto (ganador_id no nulo) -- gane indica si el usuario lo
// ganó (quedó como Padre) o lo perdió (quedó como Hijo).
interface TituloResueltoConNombre {
  id: string;
  rivalNombre: string;
  gane: boolean;
  status: "activo" | "expirado";
  fechaInicio: string | null;
}

interface ClanWarHistorialItem {
  id: string;
  rivalNombre: string;
  fechaHoraCet: string;
  resultado: "Victoria" | "Derrota" | "Empate";
}

interface TorneoHistorialItem {
  id: string;
  nombre: string;
  modo: string;
  fechaInicio: string;
  resultado: string;
}

// PostgREST embebe una relación "to-one" a veces como objeto y a veces
// como array de un elemento -- se contemplan las dos, mismo patrón que
// el resto de la app.
function extraerUno<T>(valor: unknown): T | null {
  if (Array.isArray(valor)) return (valor[0] as T) ?? null;
  return (valor as T) ?? null;
}

// Los 5 datos que hacen que un perfil se sienta "completo" -- los 4 de
// perfilEstaCompleto() más la foto (que no es obligatoria, así que no
// forma parte del gate, pero sí de este indicador amistoso).
function calcularProgresoPerfil(profile: Profile | null) {
  const campos = [
    { ok: !!profile?.nick, falta: "el nick" },
    { ok: !!profile?.country, falta: "tu país" },
    { ok: !!profile?.sc2_region, falta: "tu servidor de SC2" },
    { ok: !!profile?.sc2_id, falta: "tu ID de SC2" },
    { ok: !!profile?.avatar_url, falta: "la foto" },
  ];
  const completos = campos.filter((c) => c.ok).length;
  const faltantes = campos.filter((c) => !c.ok).map((c) => c.falta);

  let mensaje: string;
  if (faltantes.length === 0) {
    mensaje = "¡Tu perfil está completo!";
  } else if (faltantes.length === 1) {
    mensaje = `¡Ya casi! Solo te falta ${faltantes[0]}.`;
  } else {
    mensaje = "Vas bien, de a poco lo vas completando.";
  }

  return { completos, total: campos.length, mensaje };
}

// Migración 048: reorganización completa del Panel de control en 5
// accesos. "datos" y "juego" muestran contenido directo; "logros",
// "historial" y "configuracion" son un segundo menú con sus propios
// botones (subseccion), mismo patrón anidado que ya usa el Panel de
// control de /equipos/:tag.
type SeccionPerfil = "datos" | "juego" | "logros" | "historial" | "configuracion";
const SECCIONES_VALIDAS: SeccionPerfil[] = ["datos", "juego", "logros", "historial", "configuracion"];

type SubseccionPerfil = "gestor-titulos" | "clan-wars" | "torneos" | "apariencia" | "idioma" | null;

function resolverSeccion(valor: string | null): SeccionPerfil {
  return SECCIONES_VALIDAS.includes(valor as SeccionPerfil) ? (valor as SeccionPerfil) : "datos";
}

export default function ProfilePage() {
  const { user, profile, skinAvatarClave, loading, refreshProfile } = useAuth();
  const { tema, setTema } = useTheme();
  const location = useLocation();
  // El Panel de control de /jugador/:nick/:uniqueId (vitrina propia)
  // manda acá con ?tab=... -- sin el parámetro (o con cualquier otro
  // valor), arranca en "Editar datos" como siempre.
  const [searchParams] = useSearchParams();
  const [seccionActiva, setSeccionActiva] = useState<SeccionPerfil>(resolverSeccion(searchParams.get("tab")));
  const [subseccion, setSubseccion] = useState<SubseccionPerfil>(null);
  // El valor inicial de useState solo se lee en el primer montaje: si
  // ya se está parado en /perfil y se navega de nuevo acá con un ?tab=
  // distinto (el menú de la vitrina usa <Link>, no recarga la página),
  // el componente no se vuelve a montar y la sección se quedaba
  // pegada en la que estaba. Este efecto la resincroniza cada vez que
  // cambia el parámetro de la URL.
  useEffect(() => {
    setSeccionActiva(resolverSeccion(searchParams.get("tab")));
    setSubseccion(null);
  }, [searchParams]);
  // Llega desde LoginPage/RegisterPage cuando alguien con sesión activa
  // intentó entrar o registrarse de nuevo (ver Navigate en esas páginas).
  const avisoRedireccion = (location.state as { aviso?: string } | null)?.aviso ?? null;

  // --- Identidad de jugador: nick, país, servidor SC2, id SC2 ---
  // (los 4 campos que exige el gate de perfil completo).
  const [nick, setNick] = useState("");
  const [country, setCountry] = useState<Country | "">("");
  const [sc2Region, setSc2Region] = useState<Sc2Region | "">("");
  const [sc2Id, setSc2Id] = useState("");
  const [liga, setLiga] = useState<Liga | "">("");
  const [guardandoIdentidad, setGuardandoIdentidad] = useState(false);
  const [errorIdentidad, setErrorIdentidad] = useState<string | null>(null);
  const [identidadGuardada, setIdentidadGuardada] = useState(false);

  // --- Correo electrónico (migración 048): auth.updateUser(), no la
  // tabla profiles -- el correo vive únicamente en auth.users. Probado
  // en vivo contra el proyecto real: el cambio SÍ exige confirmación
  // -- auth.updateUser() devuelve el usuario con new_email = el correo
  // pendiente, pero email sigue siendo el actual hasta que se confirma
  // el link que Supabase manda al correo NUEVO. Esto es independiente
  // de "Confirm email" (esa opción es solo para el registro inicial);
  // el correo de acceso no cambia mientras no se confirme ese link.
  const [nuevoEmail, setNuevoEmail] = useState("");
  const [guardandoEmail, setGuardandoEmail] = useState(false);
  const [errorEmail, setErrorEmail] = useState<string | null>(null);
  const [emailCambioEnviado, setEmailCambioEnviado] = useState(false);

  // --- Perfil de juego de StarCraft II (migración 034): razas, en
  // perfiles_juego -- opcional, no bloquea cuenta_validada. juegoIdSc2
  // se resuelve una vez y queda guardado para el guardar/cargar. ---
  const [juegoIdSc2, setJuegoIdSc2] = useState<string | null>(null);
  const [razaPrincipal, setRazaPrincipal] = useState<RazaSc2 | "">("");
  const [razaSecundaria, setRazaSecundaria] = useState<RazaSc2 | "">("");
  const [guardandoRaza, setGuardandoRaza] = useState(false);
  const [errorRaza, setErrorRaza] = useState<string | null>(null);
  const [razaGuardada, setRazaGuardada] = useState(false);

  // --- Links de transmisión (migración 035): array libre, se edita
  // entero en memoria y se guarda de una sola vez. ---
  const [linksTransmision, setLinksTransmision] = useState<LinkTransmision[]>([]);
  const [nuevaPlataforma, setNuevaPlataforma] = useState("");
  const [nuevaUrlLink, setNuevaUrlLink] = useState("");
  const [horarioStream, setHorarioStream] = useState("");
  const [guardandoLinks, setGuardandoLinks] = useState(false);
  const [errorLinks, setErrorLinks] = useState<string | null>(null);
  const [linksGuardados, setLinksGuardados] = useState(false);

  // --- "Soy caster": switch independiente de perfil_tipo, se guarda
  // solo al tocarlo (no hace falta un botón "Guardar" aparte). ---
  const [esCaster, setEsCaster] = useState(false);
  const [guardandoCaster, setGuardandoCaster] = useState(false);
  const [errorCaster, setErrorCaster] = useState<string | null>(null);

  // --- Forma de avatar (pestaña Apariencia, migración 031): igual que
  // "Soy caster", se guarda solo al elegir una opción. ---
  const [guardandoForma, setGuardandoForma] = useState(false);
  const [errorForma, setErrorForma] = useState<string | null>(null);

  // --- Skins de avatar (migración 052): catalogo_skins_avatar solo es
  // legible vía RLS cuando es_dueno_plataforma() es verdadero -- si la
  // consulta vuelve vacía, esta sección no se muestra, sin necesidad
  // de otra verificación aparte. ---
  const [catalogoSkins, setCatalogoSkins] = useState<SkinAvatar[]>([]);
  const [guardandoSkin, setGuardandoSkin] = useState(false);
  const [errorSkin, setErrorSkin] = useState<string | null>(null);

  // --- Foto de perfil ---
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [guardandoAvatar, setGuardandoAvatar] = useState(false);
  const [errorAvatar, setErrorAvatar] = useState<string | null>(null);
  const [avatarGuardado, setAvatarGuardado] = useState(false);

  // --- Portada (banner) y descripción del perfil público -- se movió
  // acá desde /jugador/:nick/:uniqueId (esa página ahora es solo
  // vitrina, sin ningún campo editable). ---
  const [perfilBio, setPerfilBio] = useState("");
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [guardandoPerfilPublico, setGuardandoPerfilPublico] = useState(false);
  const [errorPerfilPublico, setErrorPerfilPublico] = useState<string | null>(null);
  const [perfilPublicoGuardado, setPerfilPublicoGuardado] = useState(false);

  // --- Invitaciones de equipo pendientes ---
  const [invitaciones, setInvitaciones] = useState<InvitacionConEquipo[]>([]);
  const [respondiendo, setRespondiendo] = useState<string | null>(null);
  const [errorInvitacion, setErrorInvitacion] = useState<string | null>(null);

  // --- Títulos Padre/Hijo entre jugadores (migración 026) ---
  const [titulosPendientesResponder, setTitulosPendientesResponder] = useState<TituloJugadorConNombre[]>([]);
  const [titulosPropuestosPorMi, setTitulosPropuestosPorMi] = useState<TituloJugadorConNombre[]>([]);
  const [respondiendoTitulo, setRespondiendoTitulo] = useState<string | null>(null);
  const [erroresResponderTitulo, setErroresResponderTitulo] = useState<Record<string, string>>({});

  const [busquedaNickTitulo, setBusquedaNickTitulo] = useState("");
  const [buscandoTitulo, setBuscandoTitulo] = useState(false);
  const [errorBusquedaTitulo, setErrorBusquedaTitulo] = useState<string | null>(null);
  const [rivalTitulo, setRivalTitulo] = useState<JugadorEncontrado | null>(null);
  const [duracionTitulo, setDuracionTitulo] = useState("30");
  const [casterNombreTitulo, setCasterNombreTitulo] = useState("");
  const [casterLinkTitulo, setCasterLinkTitulo] = useState("");
  const [proponiendoTitulo, setProponiendoTitulo] = useState(false);
  const [errorTitulo, setErrorTitulo] = useState<string | null>(null);
  const [tituloEnviado, setTituloEnviado] = useState(false);

  // --- Gestor de eventos de títulos (migración 048): historial
  // completo de títulos Padre/Hijo YA RESUELTOS (ganador_id no nulo),
  // activos o vencidos -- distinto de "Pendientes de responder"/
  // "Propuestos por mí" de arriba, que son solo los que siguen sin
  // jugarse. Se carga recién al abrir la subsección, no de entrada. ---
  const [gestorTitulos, setGestorTitulos] = useState<TituloResueltoConNombre[]>([]);
  const [cargandoGestorTitulos, setCargandoGestorTitulos] = useState(false);

  // --- Historial de eventos (migración 048): Clan Wars y torneos 1v1
  // en los que jugó, cada uno cargado recién al abrir su subsección. ---
  const [historialClanWars, setHistorialClanWars] = useState<ClanWarHistorialItem[]>([]);
  const [cargandoHistorialClanWars, setCargandoHistorialClanWars] = useState(false);
  const [historialTorneos, setHistorialTorneos] = useState<TorneoHistorialItem[]>([]);
  const [cargandoHistorialTorneos, setCargandoHistorialTorneos] = useState(false);

  // El perfil llega después del primer render (consulta async): cuando
  // aparece (o cambia tras guardar), sincroniza los campos del form.
  useEffect(() => {
    if (!profile) return;
    setNick(profile.nick ?? "");
    setCountry(profile.country ?? "");
    setSc2Region(profile.sc2_region ?? "");
    setSc2Id(profile.sc2_id ?? "");
    setLiga(profile.liga ?? "");
    setEsCaster(profile.es_caster);
    setLinksTransmision(profile.links_transmision ?? []);
    setHorarioStream(profile.horario_stream ?? "");
    setPerfilBio(profile.bio ?? "");
  }, [profile]);

  // El correo vive en auth.users (user), no en profiles.
  useEffect(() => {
    setNuevoEmail(user?.email ?? "");
  }, [user]);

  useEffect(() => {
    if (!user) return;

    (async () => {
      const idSc2 = await obtenerJuegoIdSc2();
      setJuegoIdSc2(idSc2);
      if (!idSc2) return;

      const { data } = await supabase
        .from("perfiles_juego")
        .select("datos")
        .eq("user_id", user.id)
        .eq("juego_id", idSc2)
        .maybeSingle();

      const datos = data?.datos as DatosSc2 | undefined;
      setRazaPrincipal(datos?.raza_principal ?? "");
      setRazaSecundaria(datos?.raza_secundaria ?? "");
    })();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setCatalogoSkins([]);
      return;
    }

    (async () => {
      const { data } = await supabase
        .from("catalogo_skins_avatar")
        .select("id, clave, nombre, descripcion")
        .order("nombre");
      setCatalogoSkins((data as SkinAvatar[] | null) ?? []);
    })();
  }, [user]);

  const cargarInvitaciones = async () => {
    if (!user) {
      setInvitaciones([]);
      return;
    }

    // team_invitations tiene DOS relaciones con profiles (invited_user_id
    // e invited_by) -- hay que especificar la columna para que PostgREST
    // no tire PGRST201 por ambigüedad (mismo caso que ya vimos con
    // tournament_participants/tournaments).
    const { data } = await supabase
      .from("team_invitations")
      .select("id, teams(name, tag, logo_url), profiles!invited_by(nick)")
      .eq("invited_user_id", user.id)
      .eq("status", "pendiente")
      .order("created_at", { ascending: false });

    setInvitaciones(
      (data ?? []).map((inv) => {
        const equipo = extraerUno<{ name: string; tag: string; logo_url: string | null }>(inv.teams);
        const invitador = extraerUno<{ nick: string | null }>(inv.profiles);
        return {
          id: inv.id,
          equipoNombre: equipo?.name ?? "Equipo de RemorApp",
          equipoTag: equipo?.tag ?? "",
          equipoLogoUrl: equipo?.logo_url ?? null,
          invitadoPorNick: invitador?.nick ?? null,
        };
      })
    );
  };

  useEffect(() => {
    cargarInvitaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const cargarTitulos = async () => {
    if (!user) {
      setTitulosPendientesResponder([]);
      setTitulosPropuestosPorMi([]);
      return;
    }

    const { data: titulosData } = await supabase
      .from("titulos_padre_hijo")
      .select("*")
      .eq("tipo", "jugador")
      .eq("status", "pendiente")
      .or(`retador_id.eq.${user.id},retado_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    const userIds = [...new Set((titulosData ?? []).flatMap((t) => [t.retador_id, t.retado_id]))];
    let nombrePorUserId: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: perfilesData } = await supabase.from("profiles").select("id, nick, unique_id").in("id", userIds);
      nombrePorUserId = Object.fromEntries(
        (perfilesData ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp"])
      );
    }

    const titulosResueltos: TituloJugadorConNombre[] = (titulosData ?? []).map((t) => ({
      id: t.id,
      retadorId: t.retador_id,
      retadorNombre: nombrePorUserId[t.retador_id] ?? "Jugador de RemorApp",
      retadoId: t.retado_id,
      retadoNombre: nombrePorUserId[t.retado_id] ?? "Jugador de RemorApp",
      duracionDias: t.duracion_dias,
      aceptado: t.aceptado,
    }));

    setTitulosPendientesResponder(titulosResueltos.filter((t) => !t.aceptado && t.retadoId === user.id));
    setTitulosPropuestosPorMi(titulosResueltos.filter((t) => t.retadorId === user.id));
  };

  useEffect(() => {
    cargarTitulos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAceptarInvitacion = async (invitationId: string) => {
    setRespondiendo(invitationId);
    setErrorInvitacion(null);

    const { error } = await supabase.rpc("aceptar_invitacion", { p_invitation_id: invitationId });

    setRespondiendo(null);

    if (error) {
      setErrorInvitacion(error.message);
      return;
    }

    setInvitaciones((prev) => prev.filter((inv) => inv.id !== invitationId));
    await refreshProfile();
  };

  const handleRechazarInvitacion = async (invitationId: string) => {
    setRespondiendo(invitationId);
    setErrorInvitacion(null);

    const { error } = await supabase.rpc("rechazar_invitacion", { p_invitation_id: invitationId });

    setRespondiendo(null);

    if (error) {
      setErrorInvitacion(error.message);
      return;
    }

    setInvitaciones((prev) => prev.filter((inv) => inv.id !== invitationId));
    await refreshProfile();
  };

  const handleBuscarRivalTitulo = async (event: FormEvent) => {
    event.preventDefault();
    setErrorBusquedaTitulo(null);
    setRivalTitulo(null);
    setTituloEnviado(false);

    const partes = busquedaNickTitulo.trim().split("#");
    if (partes.length !== 2 || !partes[0] || !partes[1]) {
      setErrorBusquedaTitulo("Escribe el Nick#ID completo, por ejemplo CarpeDiem#12345.");
      return;
    }
    const [nickBuscado, uniqueIdBuscado] = partes;

    setBuscandoTitulo(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, nick, unique_id")
      .eq("nick", nickBuscado)
      .eq("unique_id", uniqueIdBuscado)
      .maybeSingle();
    setBuscandoTitulo(false);

    if (error || !data) {
      setErrorBusquedaTitulo("No encontré a nadie con ese Nick#ID.");
      return;
    }

    setRivalTitulo({ id: data.id, nick: data.nick ?? nickBuscado, uniqueId: data.unique_id });
  };

  const handleProponerTitulo = async () => {
    if (!rivalTitulo) return;

    setErrorTitulo(null);
    const duracion = Number(duracionTitulo);

    if (!duracion || duracion < 7 || duracion > 90) {
      setErrorTitulo("La duración tiene que ser entre 7 y 90 días.");
      return;
    }
    if (!casterNombreTitulo.trim() || !casterLinkTitulo.trim()) {
      setErrorTitulo("El caster y su link son obligatorios para un título entre jugadores.");
      return;
    }

    setProponiendoTitulo(true);

    // proponer_titulo_padre_hijo() (en la base) es la que de verdad
    // valida la duración y exige el caster -- esto de acá es solo el
    // formulario.
    const { error } = await supabase.rpc("proponer_titulo_padre_hijo", {
      p_tipo: "jugador",
      p_retado_id: rivalTitulo.id,
      p_duracion_dias: duracion,
      p_caster_nombre: casterNombreTitulo.trim(),
      p_caster_link: casterLinkTitulo.trim(),
    });

    setProponiendoTitulo(false);

    if (error) {
      setErrorTitulo(error.message);
      return;
    }

    setTituloEnviado(true);
    setRivalTitulo(null);
    setBusquedaNickTitulo("");
    setCasterNombreTitulo("");
    setCasterLinkTitulo("");
    await cargarTitulos();
  };

  const handleResponderTitulo = async (tituloId: string, aceptar: boolean) => {
    setRespondiendoTitulo(tituloId);
    setErroresResponderTitulo((prev) => ({ ...prev, [tituloId]: "" }));

    const { error } = await supabase.rpc("responder_titulo_padre_hijo", {
      p_titulo_id: tituloId,
      p_aceptar: aceptar,
    });

    setRespondiendoTitulo(null);

    if (error) {
      setErroresResponderTitulo((prev) => ({ ...prev, [tituloId]: error.message }));
      return;
    }

    await cargarTitulos();
  };

  // Gestor de eventos de títulos (migración 048): historial de títulos
  // Padre/Hijo ya resueltos (ganador_id no nulo) -- se carga recién al
  // abrir la subsección, no de entrada.
  const cargarGestorTitulos = async () => {
    if (!user) return;
    setCargandoGestorTitulos(true);

    const { data } = await supabase
      .from("titulos_padre_hijo")
      .select("*")
      .eq("tipo", "jugador")
      .or(`retador_id.eq.${user.id},retado_id.eq.${user.id}`)
      .not("ganador_id", "is", null)
      .order("fecha_inicio", { ascending: false });

    const filas = data ?? [];
    const rivalIds = [
      ...new Set(filas.map((t) => (t.retador_id === user.id ? t.retado_id : t.retador_id))),
    ];
    let nombrePorId: Record<string, string> = {};
    if (rivalIds.length > 0) {
      const { data: perfilesData } = await supabase.from("profiles").select("id, nick, unique_id").in("id", rivalIds);
      nombrePorId = Object.fromEntries(
        (perfilesData ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp"])
      );
    }

    setGestorTitulos(
      filas.map((t) => ({
        id: t.id,
        rivalNombre: nombrePorId[t.retador_id === user.id ? t.retado_id : t.retador_id] ?? "Jugador de RemorApp",
        gane: t.ganador_id === user.id,
        status: t.status === "activo" ? "activo" : "expirado",
        fechaInicio: t.fecha_inicio,
      }))
    );
    setCargandoGestorTitulos(false);
  };

  // Historial de Clan Wars (migración 048): solo los retos ya resueltos
  // (finalizada/empatada) donde el usuario formó parte del lineup real
  // -- no cualquier reto de su equipo, específicamente los que jugó.
  const cargarHistorialClanWars = async () => {
    if (!user) return;
    setCargandoHistorialClanWars(true);

    const { data: lineupData } = await supabase
      .from("clan_war_lineup")
      .select("clan_war_id, team_id, clan_wars(id, challenger_team_id, challenged_team_id, status, ganador_team_id, fecha_hora_cet)")
      .eq("jugador_id", user.id);

    const filas = (lineupData ?? [])
      .map((f) => ({ teamId: f.team_id, reto: extraerUno<{
        id: string;
        challenger_team_id: string;
        challenged_team_id: string;
        status: string;
        ganador_team_id: string | null;
        fecha_hora_cet: string;
      }>(f.clan_wars) }))
      .filter((f) => f.reto && (f.reto.status === "finalizada" || f.reto.status === "empatada"));

    const teamIds = [
      ...new Set(
        filas.flatMap((f) => [f.reto!.challenger_team_id, f.reto!.challenged_team_id])
      ),
    ];
    let nombrePorTeamId: Record<string, string> = {};
    if (teamIds.length > 0) {
      const { data: equiposData } = await supabase.from("teams").select("id, name, tag").in("id", teamIds);
      nombrePorTeamId = Object.fromEntries((equiposData ?? []).map((t) => [t.id, `${t.name} [${t.tag}]`]));
    }

    setHistorialClanWars(
      filas.map((f) => {
        const reto = f.reto!;
        const rivalTeamId = reto.challenger_team_id === f.teamId ? reto.challenged_team_id : reto.challenger_team_id;
        const resultado: ClanWarHistorialItem["resultado"] =
          reto.status === "empatada" ? "Empate" : reto.ganador_team_id === f.teamId ? "Victoria" : "Derrota";
        return {
          id: reto.id,
          rivalNombre: nombrePorTeamId[rivalTeamId] ?? "Equipo",
          fechaHoraCet: reto.fecha_hora_cet,
          resultado,
        };
      })
    );
    setCargandoHistorialClanWars(false);
  };

  // Historial de torneos 1v1 independientes (migración 048): por
  // tournament_participants.user_id -- los torneos por equipo ya
  // tienen su propio historial en la página del equipo, este es solo
  // el de inscripción individual (incluye los organizados por un
  // caster de forma independiente: son torneos comunes, sin ningún
  // caso especial).
  const cargarHistorialTorneos = async () => {
    if (!user) return;
    setCargandoHistorialTorneos(true);

    // tournaments!tournament_participants_tournament_id_fkey: hace
    // falta calificar la relación -- tournaments tiene DOS FK más hacia
    // tournament_participants (campeon_participant_id y
    // tercer_lugar_participant_id), así que el embed por defecto queda
    // ambiguo (PGRST201) sin esto.
    const { data: participacionesData } = await supabase
      .from("tournament_participants")
      .select(
        "id, tournament_id, tournaments!tournament_participants_tournament_id_fkey(nombre, modo, estado, fecha_inicio, campeon_participant_id, tercer_lugar_participant_id)"
      )
      .eq("user_id", user.id);

    const filas = (participacionesData ?? [])
      .map((p) => ({
        participantId: p.id as string,
        tournamentId: p.tournament_id as string,
        torneo: extraerUno<{
          nombre: string;
          modo: string;
          estado: string;
          fecha_inicio: string;
          campeon_participant_id: string | null;
          tercer_lugar_participant_id: string | null;
        }>(p.tournaments),
      }))
      .filter((p) => p.torneo && p.torneo.estado === "finalizado");

    const idsEliminacion = filas.filter((p) => p.torneo!.modo === "eliminacion_simple").map((p) => p.participantId);
    let perdioPorParticipante: Record<string, boolean> = {};
    if (idsEliminacion.length > 0) {
      const { data: partidasData } = await supabase
        .from("bracket_matches")
        .select("participant1_id, participant2_id, winner_id, status")
        .eq("status", "jugado")
        .or(
          idsEliminacion
            .map((id) => `participant1_id.eq.${id},participant2_id.eq.${id}`)
            .join(",")
        );
      for (const m of partidasData ?? []) {
        for (const pid of [m.participant1_id, m.participant2_id]) {
          if (pid && idsEliminacion.includes(pid) && m.winner_id !== pid) {
            perdioPorParticipante[pid] = true;
          }
        }
      }
    }

    const idsOtrosModos = filas.filter((p) => p.torneo!.modo !== "eliminacion_simple").map((p) => p.participantId);
    let resultadosPorParticipante: Record<string, { ganados: number; jugados: number }> = {};
    if (idsOtrosModos.length > 0) {
      const { data: resultadosData } = await supabase
        .from("tournament_results")
        .select("participant_id, gano")
        .in("participant_id", idsOtrosModos);
      for (const r of resultadosData ?? []) {
        const actual = resultadosPorParticipante[r.participant_id] ?? { ganados: 0, jugados: 0 };
        actual.jugados += 1;
        if (r.gano) actual.ganados += 1;
        resultadosPorParticipante[r.participant_id] = actual;
      }
    }

    setHistorialTorneos(
      filas.map((p) => {
        const torneo = p.torneo!;
        let resultado: string;
        if (torneo.modo === "eliminacion_simple") {
          if (torneo.campeon_participant_id === p.participantId) resultado = "Campeón";
          else if (torneo.tercer_lugar_participant_id === p.participantId) resultado = "Tercer lugar";
          else if (perdioPorParticipante[p.participantId]) resultado = "Eliminado";
          else resultado = "Sin resultado registrado";
        } else {
          const r = resultadosPorParticipante[p.participantId];
          resultado = r ? `${r.ganados} ganadas de ${r.jugados}` : "Sin resultado registrado";
        }
        return {
          id: p.tournamentId,
          nombre: torneo.nombre,
          modo: torneo.modo,
          fechaInicio: torneo.fecha_inicio,
          resultado,
        };
      })
    );
    setCargandoHistorialTorneos(false);
  };

  if (!loading && !user) {
    return (
      <section className="page-placeholder">
        <h1>Inicia sesión para ver tu perfil</h1>
        <p>
          <Link to="/login" className="btn-link">
            Iniciar sesión
          </Link>
        </p>
      </section>
    );
  }

  const handleGuardarIdentidad = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const errorNick = validarNick(nick);
    if (errorNick) {
      setErrorIdentidad(errorNick);
      return;
    }
    if (!country || !sc2Region || !sc2Id.trim()) {
      setErrorIdentidad("Debes completar todos los campos.");
      return;
    }

    setGuardandoIdentidad(true);
    setErrorIdentidad(null);
    setIdentidadGuardada(false);

    // cuenta_validada no se manda: se recalcula sola en la base
    // (trigger actualizar_cuenta_validada) a partir de los 4 campos
    // obligatorios. Migración 048: liga se movió a "Editar datos de
    // juego" (handleGuardarDatosJuego), ya no se manda acá.
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ nick, country, sc2_region: sc2Region, sc2_id: sc2Id.trim() })
      .eq("id", user.id);

    setGuardandoIdentidad(false);

    if (updateError) {
      setErrorIdentidad(updateError.message);
      return;
    }

    await refreshProfile();
    setIdentidadGuardada(true);
  };

  // Correo electrónico (migración 048): auth.updateUser(), no la tabla
  // profiles -- ver el comentario largo junto a los estados de acá
  // arriba sobre la confirmación obligatoria por correo.
  const handleGuardarEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const emailLimpio = nuevoEmail.trim();
    if (!emailLimpio || emailLimpio === user.email) return;

    setGuardandoEmail(true);
    setErrorEmail(null);
    setEmailCambioEnviado(false);

    const { error } = await supabase.auth.updateUser({ email: emailLimpio });

    setGuardandoEmail(false);

    if (error) {
      setErrorEmail(error.message);
      return;
    }

    setEmailCambioEnviado(true);
  };

  // Migración 048: raza (perfiles_juego) y liga (profiles) se guardan
  // juntas con un solo botón -- las dos son "datos de juego" de
  // StarCraft II, aunque técnicamente vivan en tablas distintas.
  const handleGuardarDatosJuego = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !juegoIdSc2) return;

    setGuardandoRaza(true);
    setErrorRaza(null);
    setRazaGuardada(false);

    const datos: DatosSc2 = {
      raza_principal: razaPrincipal || null,
      raza_secundaria: razaSecundaria || null,
    };

    const { error } = await supabase
      .from("perfiles_juego")
      .upsert({ user_id: user.id, juego_id: juegoIdSc2, datos }, { onConflict: "user_id,juego_id" });

    if (error) {
      setGuardandoRaza(false);
      setErrorRaza(error.message);
      return;
    }

    // liga es de profiles, no de perfiles_juego -- se guarda en el
    // mismo envío para que "Editar datos de juego" tenga un solo botón.
    const { error: errorLiga } = await supabase.from("profiles").update({ liga: liga || null }).eq("id", user.id);

    setGuardandoRaza(false);

    if (errorLiga) {
      setErrorRaza(errorLiga.message);
      return;
    }

    await refreshProfile();
    setRazaGuardada(true);
  };

  const handleAgregarLink = () => {
    if (!nuevaPlataforma.trim() || !nuevaUrlLink.trim()) {
      setErrorLinks("Completa la plataforma y el link.");
      return;
    }

    setErrorLinks(null);
    setLinksGuardados(false);
    setLinksTransmision((prev) => [...prev, { plataforma: nuevaPlataforma.trim(), url: nuevaUrlLink.trim() }]);
    setNuevaPlataforma("");
    setNuevaUrlLink("");
  };

  const handleQuitarLink = (indice: number) => {
    setLinksGuardados(false);
    setLinksTransmision((prev) => prev.filter((_, i) => i !== indice));
  };

  const handleGuardarLinks = async () => {
    if (!user) return;

    setGuardandoLinks(true);
    setErrorLinks(null);
    setLinksGuardados(false);

    const { error } = await supabase
      .from("profiles")
      .update({ links_transmision: linksTransmision, horario_stream: horarioStream.trim() || null })
      .eq("id", user.id);

    setGuardandoLinks(false);

    if (error) {
      setErrorLinks(error.message);
      return;
    }

    await refreshProfile();
    setLinksGuardados(true);
  };

  const handleToggleCaster = async () => {
    if (!user) return;

    const nuevoValor = !esCaster;
    setEsCaster(nuevoValor);
    setGuardandoCaster(true);
    setErrorCaster(null);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ es_caster: nuevoValor })
      .eq("id", user.id);

    setGuardandoCaster(false);

    if (updateError) {
      setEsCaster(!nuevoValor); // revierte el cambio optimista si falló
      setErrorCaster(updateError.message);
      return;
    }

    await refreshProfile();
  };

  const handleCambiarFormaAvatar = async (nuevaForma: AvatarForma) => {
    if (!user || nuevaForma === profile?.avatar_forma) return;

    setGuardandoForma(true);
    setErrorForma(null);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_forma: nuevaForma })
      .eq("id", user.id);

    setGuardandoForma(false);

    if (updateError) {
      setErrorForma(updateError.message);
      return;
    }

    await refreshProfile();
  };

  const handleActivarSkin = async (skinId: string | null) => {
    if (!user || skinId === profile?.skin_avatar_activa) return;

    setGuardandoSkin(true);
    setErrorSkin(null);

    const { error: rpcError } = await supabase.rpc("activar_skin_avatar", { p_skin_id: skinId });

    setGuardandoSkin(false);

    if (rpcError) {
      setErrorSkin(rpcError.message);
      return;
    }

    await refreshProfile();
  };

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setErrorAvatar(null);
    setAvatarGuardado(false);

    if (!archivo) {
      setAvatarFile(null);
      setAvatarPreview(null);
      return;
    }

    if (archivo.size > AVATAR_MAX_BYTES) {
      setErrorAvatar("La foto no puede pesar más de 2MB.");
      event.target.value = "";
      return;
    }

    setAvatarFile(archivo);
    setAvatarPreview(URL.createObjectURL(archivo));
  };

  const handleGuardarAvatar = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !avatarFile) return;

    setGuardandoAvatar(true);
    setErrorAvatar(null);
    setAvatarGuardado(false);

    try {
      const recorte = await recortarImagenCuadrada(avatarFile);
      const extension = avatarFile.type === "image/png" ? "png" : "jpg";
      const ruta = `${user.id}/${Date.now()}-avatar.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(ruta, recorte, { contentType: recorte.type });

      if (uploadError) {
        setErrorAvatar("No se pudo subir la foto: " + uploadError.message);
        setGuardandoAvatar(false);
        return;
      }

      const avatarUrl = supabase.storage.from("avatars").getPublicUrl(ruta).data.publicUrl;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", user.id);

      if (updateError) {
        setErrorAvatar(updateError.message);
        setGuardandoAvatar(false);
        return;
      }

      await refreshProfile();
      setAvatarFile(null);
      setAvatarPreview(null);
      setAvatarGuardado(true);
    } catch {
      setErrorAvatar("No se pudo procesar la foto, prueba con otra imagen.");
    } finally {
      setGuardandoAvatar(false);
    }
  };

  const handleBannerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setErrorPerfilPublico(null);
    setPerfilPublicoGuardado(false);

    if (!archivo) {
      setBannerFile(null);
      setBannerPreview(null);
      return;
    }

    if (archivo.size > BANNER_MAX_BYTES) {
      setErrorPerfilPublico("El banner no puede pesar más de 3MB.");
      event.target.value = "";
      return;
    }

    setBannerFile(archivo);
    setBannerPreview(URL.createObjectURL(archivo));
  };

  const handleGuardarPerfilPublico = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    setGuardandoPerfilPublico(true);
    setErrorPerfilPublico(null);
    setPerfilPublicoGuardado(false);

    const cambios: { bio: string | null; banner_url?: string } = {
      bio: perfilBio.trim() || null,
    };

    try {
      if (bannerFile) {
        const recorte = await recortarImagenConProporcion(bannerFile, 4);
        const extension = bannerFile.type === "image/png" ? "png" : "jpg";
        const ruta = `${user.id}/${Date.now()}-banner.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("player-banners")
          .upload(ruta, recorte, { contentType: recorte.type });

        if (uploadError) {
          setErrorPerfilPublico("No se pudo subir el banner: " + uploadError.message);
          setGuardandoPerfilPublico(false);
          return;
        }

        cambios.banner_url = supabase.storage.from("player-banners").getPublicUrl(ruta).data.publicUrl;
      }
    } catch {
      setErrorPerfilPublico("No se pudo procesar el banner, prueba con otra imagen.");
      setGuardandoPerfilPublico(false);
      return;
    }

    const { error: updateError } = await supabase.from("profiles").update(cambios).eq("id", user.id);

    setGuardandoPerfilPublico(false);

    if (updateError) {
      setErrorPerfilPublico(updateError.message);
      return;
    }

    setBannerFile(null);
    setBannerPreview(null);
    await refreshProfile();
    setPerfilPublicoGuardado(true);
  };

  const completo = perfilEstaCompleto(profile);
  const progreso = calcularProgresoPerfil(profile);

  return (
    <section className="auth-page">
      <h1 className="auth-title">Mi perfil</h1>

      {avisoRedireccion && <div className="form-hint profile-gate-banner">{avisoRedireccion}</div>}

      {invitaciones.length > 0 && (
        <>
          <h2 className="detail-subtitle">Invitaciones de equipo</h2>
          {errorInvitacion && <div className="form-error">{errorInvitacion}</div>}
          <div className="invitation-list">
            {invitaciones.map((inv) => (
              <div key={inv.id} className="invitation-card">
                <Avatar url={inv.equipoLogoUrl} nombre={inv.equipoNombre} className="detail-participant-avatar" />
                <div className="invitation-info">
                  <p className="invitation-team">
                    {inv.equipoNombre} <span className="profile-nick-id">[{inv.equipoTag}]</span>
                  </p>
                  {inv.invitadoPorNick && (
                    <p className="tournament-card-meta">Invitado por {inv.invitadoPorNick}</p>
                  )}
                </div>
                <div className="invitation-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={respondiendo === inv.id}
                    onClick={() => handleAceptarInvitacion(inv.id)}
                  >
                    Aceptar
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={respondiendo === inv.id}
                    onClick={() => handleRechazarInvitacion(inv.id)}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="detail-subtitle" id="titulos-padre-hijo">
        Títulos Padre/Hijo
      </h2>
      <p className="tournament-card-meta">
        Se resuelven solos cuando ganas o pierdes una partida 1v1 real contra el rival, en cualquier
        torneo.
      </p>
      {profile && <TitulosActivosList tipo="jugador" id={profile.id} className="detail-map-list" />}

      <h3 className="detail-subtitle">Pendientes de responder</h3>
      {titulosPendientesResponder.length === 0 ? (
        <p className="detail-empty">No tienes retos de título pendientes de responder.</p>
      ) : (
        <div className="detail-participant-list">
          {titulosPendientesResponder.map((t) => (
            <div key={t.id} className="reto-item">
              <p className="reto-desc">
                {t.retadorNombre} te reta a un título ({t.duracionDias} días)
              </p>
              {erroresResponderTitulo[t.id] && (
                <div className="form-error">{erroresResponderTitulo[t.id]}</div>
              )}
              <div className="invitation-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={respondiendoTitulo === t.id}
                  onClick={() => handleResponderTitulo(t.id, true)}
                >
                  Aceptar
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={respondiendoTitulo === t.id}
                  onClick={() => handleResponderTitulo(t.id, false)}
                >
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="detail-subtitle">Propuestos por mí</h3>
      {titulosPropuestosPorMi.length === 0 ? (
        <p className="detail-empty">No propusiste ningún título.</p>
      ) : (
        <div className="detail-participant-list">
          {titulosPropuestosPorMi.map((t) => (
            <div key={t.id} className="reto-item">
              <p className="reto-desc">
                Título contra {t.retadoNombre} ({t.duracionDias} días)
                <span className="reto-status">
                  {t.aceptado ? "Acordado, esperando la partida" : "Esperando respuesta"}
                </span>
              </p>
            </div>
          ))}
        </div>
      )}

      <h3 className="detail-subtitle">Proponer un título</h3>
      <form className="auth-form" onSubmit={handleBuscarRivalTitulo}>
        {errorBusquedaTitulo && <div className="form-error">{errorBusquedaTitulo}</div>}
        {tituloEnviado && <div className="form-success">¡Título propuesto!</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="titulo-buscar-nick">
            Nick#ID del rival
          </label>
          <input
            id="titulo-buscar-nick"
            className="form-input"
            type="text"
            placeholder="CarpeDiem#12345"
            value={busquedaNickTitulo}
            onChange={(e) => setBusquedaNickTitulo(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-ghost btn-block" disabled={buscandoTitulo}>
          {buscandoTitulo ? "Buscando..." : "Buscar"}
        </button>
      </form>

      {rivalTitulo && (
        <div className="detail-participant-item">
          {rivalTitulo.nick}
          <span className="profile-nick-id">#{rivalTitulo.uniqueId}</span>
        </div>
      )}

      {rivalTitulo && (
        <div className="auth-form">
          {errorTitulo && <div className="form-error">{errorTitulo}</div>}

          <div className="form-group">
            <label className="form-label" htmlFor="titulo-duracion-jugador">
              Duración (entre 7 y 90 días)
            </label>
            <input
              id="titulo-duracion-jugador"
              className="form-input"
              type="number"
              min={7}
              max={90}
              value={duracionTitulo}
              onChange={(e) => setDuracionTitulo(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="titulo-caster-nombre">
              Nombre del caster
            </label>
            <input
              id="titulo-caster-nombre"
              className="form-input"
              type="text"
              value={casterNombreTitulo}
              onChange={(e) => setCasterNombreTitulo(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="titulo-caster-link">
              Link de la transmisión
            </label>
            <input
              id="titulo-caster-link"
              className="form-input"
              type="text"
              value={casterLinkTitulo}
              onChange={(e) => setCasterLinkTitulo(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={proponiendoTitulo}
            onClick={handleProponerTitulo}
          >
            {proponiendoTitulo ? "Proponiendo..." : "Proponer título"}
          </button>
        </div>
      )}

      {profile?.nick ? (
        <p className="profile-nick-display">
          {profile.nick}
          <span className="profile-nick-id">#{profile.unique_id}</span>
        </p>
      ) : (
        <p className="auth-sub">{profile?.nombre ?? "Jugador de RemorApp"}</p>
      )}

      <div className="profile-progress">
        <div className="profile-progress-bar">
          <div
            className="profile-progress-fill"
            style={{ width: `${(progreso.completos / progreso.total) * 100}%` }}
          />
        </div>
        <p className="profile-progress-text">
          {progreso.completos} de {progreso.total} datos completos — {progreso.mensaje}
        </p>
      </div>

      {!completo && (
        <div className="form-hint profile-gate-banner">
          Completa tu perfil para acceder a más funciones
        </div>
      )}

      {/* Las estadísticas (MMR, Valentía, Responsabilidad) NO se
          repiten acá: son contenido de la vitrina pública
          (/jugador/:nick/:uniqueId, "Mi perfil" en la barra inferior),
          no de esta página de edición. Mostrarlas acá también era
          justamente lo que hacía que "Editar mis datos" y "Mi perfil"
          se sintieran mezclados en una sola pantalla. */}
      <h2 className="detail-subtitle">Panel de control</h2>
      <div className="settings-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={seccionActiva === "datos"}
          className={`settings-tab ${seccionActiva === "datos" ? "active" : ""}`}
          onClick={() => {
            setSeccionActiva("datos");
            setSubseccion(null);
          }}
        >
          Editar datos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={seccionActiva === "juego"}
          className={`settings-tab ${seccionActiva === "juego" ? "active" : ""}`}
          onClick={() => {
            setSeccionActiva("juego");
            setSubseccion(null);
          }}
        >
          Editar datos de juego
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={seccionActiva === "logros"}
          className={`settings-tab ${seccionActiva === "logros" ? "active" : ""}`}
          onClick={() => {
            setSeccionActiva("logros");
            setSubseccion(null);
          }}
        >
          Logros y Recompensas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={seccionActiva === "historial"}
          className={`settings-tab ${seccionActiva === "historial" ? "active" : ""}`}
          onClick={() => {
            setSeccionActiva("historial");
            setSubseccion(null);
          }}
        >
          Historial de eventos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={seccionActiva === "configuracion"}
          className={`settings-tab ${seccionActiva === "configuracion" ? "active" : ""}`}
          onClick={() => {
            setSeccionActiva("configuracion");
            setSubseccion(null);
          }}
        >
          Configuración
        </button>
      </div>

      {seccionActiva === "datos" && (
        <div className="settings-panel">
          <div className="profile-avatar-section">
            <AvatarSkin clave={skinAvatarClave} forma={profile?.avatar_forma}>
              <Avatar
                url={avatarPreview ?? profile?.avatar_url}
                nombre={profile?.nick ?? profile?.nombre}
                className="profile-avatar"
                forma={profile?.avatar_forma}
              />
            </AvatarSkin>
            {!avatarPreview && !profile?.avatar_url && (
              <p className="profile-avatar-hint">Sube tu foto para que te reconozcan en tu clan.</p>
            )}
            <form className="profile-avatar-form" onSubmit={handleGuardarAvatar}>
              {errorAvatar && <div className="form-error">{errorAvatar}</div>}
              {avatarGuardado && <div className="form-success">¡Foto actualizada!</div>}
              <input
                id="perfil-avatar"
                className="form-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarChange}
              />
              {avatarFile && (
                <button type="submit" className="btn btn-ghost btn-block" disabled={guardandoAvatar}>
                  {guardandoAvatar ? "Subiendo..." : "Guardar foto"}
                </button>
              )}
            </form>
          </div>

          <h3 className="detail-subtitle">Portada y descripción</h3>
          <form className="auth-form" onSubmit={handleGuardarPerfilPublico}>
            {errorPerfilPublico && <div className="form-error">{errorPerfilPublico}</div>}
            {perfilPublicoGuardado && <div className="form-success">Tu perfil público se guardó correctamente.</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-banner">
                Banner (opcional, máx. 3MB, se recorta a 4:1)
              </label>
              <input
                id="perfil-banner"
                className="form-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleBannerChange}
              />
              {(bannerPreview ?? profile?.banner_url) && (
                <img
                  src={bannerPreview ?? profile?.banner_url ?? ""}
                  alt="Vista previa del banner"
                  className="team-banner-preview"
                />
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-bio">
                Descripción
              </label>
              <textarea
                id="perfil-bio"
                className="form-textarea"
                maxLength={280}
                value={perfilBio}
                onChange={(e) => setPerfilBio(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={guardandoPerfilPublico}>
              {guardandoPerfilPublico ? "Guardando..." : "Guardar"}
            </button>
          </form>

          <form className="auth-form" onSubmit={handleGuardarIdentidad}>
            {errorIdentidad && <div className="form-error">{errorIdentidad}</div>}
            {identidadGuardada && <div className="form-success">Tu perfil se guardó correctamente.</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-nick">
                Nick
              </label>
              <input
                id="perfil-nick"
                className="form-input"
                type="text"
                required
                value={nick}
                onChange={(e) => setNick(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-country">
                País (de dónde eres)
              </label>
              <select
                id="perfil-country"
                className="form-select"
                required
                value={country}
                onChange={(e) => setCountry(e.target.value as Country)}
              >
                <option value="" disabled>
                  Elige tu país
                </option>
                {COUNTRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Servidor e ID de StarCraft II siguen acá (no en "Editar
                datos de juego"): son, junto con nick y país, los 4
                campos que exige el gate de perfil completo -- separarlos
                hubiera partido esa identidad mínima en dos secciones. */}
            <h3 className="detail-subtitle">StarCraft II</h3>

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-sc2-region">
                Servidor de StarCraft II (al que te conectas)
              </label>
              <select
                id="perfil-sc2-region"
                className="form-select"
                required
                value={sc2Region}
                onChange={(e) => setSc2Region(e.target.value as Sc2Region)}
              >
                <option value="" disabled>
                  Elige tu servidor
                </option>
                {SC2_REGION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-sc2-id">
                ID de StarCraft II
              </label>
              <input
                id="perfil-sc2-id"
                className="form-input"
                type="text"
                required
                value={sc2Id}
                onChange={(e) => setSc2Id(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={guardandoIdentidad}>
              {guardandoIdentidad ? "Guardando..." : "Guardar"}
            </button>
          </form>

          <h3 className="detail-subtitle">Correo electrónico</h3>
          <form className="auth-form" onSubmit={handleGuardarEmail}>
            {errorEmail && <div className="form-error">{errorEmail}</div>}
            {emailCambioEnviado && (
              <div className="form-success">
                Te mandamos un link de confirmación al correo nuevo. Hasta que no lo confirmes, tu
                correo de acceso sigue siendo el actual.
              </div>
            )}
            <div className="form-group">
              <label className="form-label" htmlFor="perfil-email">
                Correo electrónico
              </label>
              <input
                id="perfil-email"
                className="form-input"
                type="email"
                required
                value={nuevoEmail}
                onChange={(e) => setNuevoEmail(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn btn-ghost btn-block"
              disabled={guardandoEmail || nuevoEmail.trim() === (user?.email ?? "")}
            >
              {guardandoEmail ? "Guardando..." : "Cambiar correo"}
            </button>
          </form>

          <div className="auth-form">
            {errorCaster && <div className="form-error">{errorCaster}</div>}
            <label className="profile-caster-toggle">
              <input
                type="checkbox"
                checked={esCaster}
                onChange={handleToggleCaster}
                disabled={guardandoCaster}
              />
              Soy caster
            </label>
          </div>

          {/* Migración 048: los links ya no son exclusivos de un
              caster -- son un dato general (Discord, YouTube, Twitch,
              lo que sea), disponible para cualquier jugador. "Soy
              caster" arriba solo decide si además se muestran como
              "Transmisión" en el perfil público. */}
          <h3 className="detail-subtitle">Links (Discord, YouTube, Twitch...)</h3>
          {errorLinks && <div className="form-error">{errorLinks}</div>}
          {linksGuardados && <div className="form-success">Tus links se guardaron correctamente.</div>}

          {linksTransmision.length > 0 && (
            <div className="detail-participant-list">
              {linksTransmision.map((link, indice) => (
                <div key={`${link.plataforma}-${indice}`} className="detail-participant-item">
                  {link.plataforma}
                  <span className="profile-nick-id">{link.url}</span>
                  <button type="button" className="btn btn-ghost" onClick={() => handleQuitarLink(indice)}>
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="auth-form">
            <div className="form-group">
              <label className="form-label" htmlFor="perfil-link-plataforma">
                Plataforma
              </label>
              <input
                id="perfil-link-plataforma"
                className="form-input"
                type="text"
                placeholder="Twitch, YouTube, Kick..."
                value={nuevaPlataforma}
                onChange={(e) => setNuevaPlataforma(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="perfil-link-url">
                Link
              </label>
              <input
                id="perfil-link-url"
                className="form-input"
                type="text"
                placeholder="https://twitch.tv/tu-canal"
                value={nuevaUrlLink}
                onChange={(e) => setNuevaUrlLink(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-ghost btn-block" onClick={handleAgregarLink}>
              Agregar link
            </button>

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-horario-stream">
                Horario habitual de transmisión (opcional)
              </label>
              <input
                id="perfil-horario-stream"
                className="form-input"
                type="text"
                placeholder="Ej: Martes y jueves, 20:00 (hora Chile)"
                value={horarioStream}
                onChange={(e) => setHorarioStream(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={guardandoLinks}
              onClick={handleGuardarLinks}
            >
              {guardandoLinks ? "Guardando..." : "Guardar links"}
            </button>
          </div>
        </div>
      )}

      {/* Editar datos de juego (migración 048): por ahora solo
          StarCraft II, el único juego activo -- perfiles_juego ya está
          preparada para más juegos (juego_id genérico), acá solo hace
          falta agregar un bloque análogo a este el día que exista un
          segundo juego, sin tocar el esquema. */}
      {seccionActiva === "juego" && (
        <div className="settings-panel">
          <h3 className="detail-subtitle">StarCraft II</h3>
          <p className="tournament-card-meta">
            Estos datos se ven en el roster de tu equipo, junto al resto de tus compañeros.
          </p>
          <form className="auth-form" onSubmit={handleGuardarDatosJuego}>
            {errorRaza && <div className="form-error">{errorRaza}</div>}
            {razaGuardada && <div className="form-success">Tus datos de juego se guardaron correctamente.</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-raza-principal">
                Raza principal
              </label>
              <select
                id="perfil-raza-principal"
                className="form-select"
                value={razaPrincipal}
                onChange={(e) => setRazaPrincipal(e.target.value as RazaSc2)}
              >
                <option value="">Prefiero no decirlo</option>
                {RAZA_SC2_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-raza-secundaria">
                Raza secundaria (opcional)
              </label>
              <select
                id="perfil-raza-secundaria"
                className="form-select"
                value={razaSecundaria}
                onChange={(e) => setRazaSecundaria(e.target.value as RazaSc2)}
              >
                <option value="">Ninguna</option>
                {RAZA_SC2_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="perfil-liga">
                Liga (opcional)
              </label>
              <select
                id="perfil-liga"
                className="form-select"
                value={liga}
                onChange={(e) => setLiga(e.target.value as Liga)}
              >
                <option value="">Prefiero no decirlo</option>
                {LIGA_OPTIONS.map((opcion) => (
                  <option key={opcion} value={opcion}>
                    {opcion}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={guardandoRaza || !juegoIdSc2}>
              {guardandoRaza ? "Guardando..." : "Guardar"}
            </button>
          </form>
        </div>
      )}

      {seccionActiva === "logros" && (
        <div className="settings-panel">
          {subseccion === null ? (
            <>
              <h3 className="detail-subtitle">Títulos por nivel</h3>
              <p className="detail-empty">
                Todavía no existe un catálogo de títulos o recompensas por nivel -- esta vitrina va a
                mostrarlos acá en cuanto ese catálogo esté listo.
              </p>

              <div className="team-panel-menu">
                <button
                  type="button"
                  className="team-panel-menu-item"
                  onClick={() => {
                    setSubseccion("gestor-titulos");
                    cargarGestorTitulos();
                  }}
                >
                  <span className="team-panel-menu-item-title">Gestor de eventos de títulos</span>
                  <span className="team-panel-menu-item-desc">
                    Cuántas veces ganaste o perdiste un título Padre/Hijo, y de quién
                  </span>
                </button>
              </div>
            </>
          ) : (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubseccion(null)}>
                ← Volver
              </button>
              <h3 className="detail-subtitle">Gestor de eventos de títulos</h3>
              {cargandoGestorTitulos ? (
                <p className="tournament-card-meta">Cargando...</p>
              ) : gestorTitulos.length === 0 ? (
                <p className="detail-empty">Todavía no tienes ningún título Padre/Hijo resuelto.</p>
              ) : (
                <>
                  <p className="tournament-card-meta">
                    Ganaste {gestorTitulos.filter((t) => t.gane).length} · Perdiste{" "}
                    {gestorTitulos.filter((t) => !t.gane).length}
                  </p>
                  <div className="detail-participant-list">
                    {gestorTitulos.map((t) => (
                      <div key={t.id} className="reto-item">
                        <p className="reto-desc">
                          {t.gane ? "Padre" : "Hijo"} de {t.rivalNombre}
                          <span className="reto-status">{t.gane ? "Ganaste" : "Perdiste"}</span>
                        </p>
                        <p className="tournament-card-meta">
                          {t.status === "activo" ? "Título activo" : "Título vencido"}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {seccionActiva === "historial" && (
        <div className="settings-panel">
          {subseccion === null && (
            <div className="team-panel-menu">
              <button
                type="button"
                className="team-panel-menu-item"
                onClick={() => {
                  setSubseccion("clan-wars");
                  cargarHistorialClanWars();
                }}
              >
                <span className="team-panel-menu-item-title">Clan Wars</span>
                <span className="team-panel-menu-item-desc">Contra qué equipo jugaste y el resultado</span>
              </button>
              <button
                type="button"
                className="team-panel-menu-item"
                onClick={() => {
                  setSubseccion("torneos");
                  cargarHistorialTorneos();
                }}
              >
                <span className="team-panel-menu-item-title">Torneos</span>
                <span className="team-panel-menu-item-desc">Torneos independientes en los que participaste</span>
              </button>
            </div>
          )}

          {subseccion === "clan-wars" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubseccion(null)}>
                ← Volver
              </button>
              <h3 className="detail-subtitle">Clan Wars</h3>
              {cargandoHistorialClanWars ? (
                <p className="tournament-card-meta">Cargando...</p>
              ) : historialClanWars.length === 0 ? (
                <p className="detail-empty">Todavía no jugaste ninguna Clan War.</p>
              ) : (
                <div className="detail-participant-list">
                  {historialClanWars.map((cw) => (
                    <div key={cw.id} className="reto-item">
                      <p className="reto-desc">
                        vs {cw.rivalNombre}
                        <span className="reto-status">{cw.resultado}</span>
                      </p>
                      <p className="tournament-card-meta">{formatFecha(cw.fechaHoraCet)}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {subseccion === "torneos" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubseccion(null)}>
                ← Volver
              </button>
              <h3 className="detail-subtitle">Torneos</h3>
              {cargandoHistorialTorneos ? (
                <p className="tournament-card-meta">Cargando...</p>
              ) : historialTorneos.length === 0 ? (
                <p className="detail-empty">Todavía no participaste en ningún torneo independiente.</p>
              ) : (
                <div className="detail-participant-list">
                  {historialTorneos.map((t) => (
                    <div key={t.id} className="reto-item">
                      <p className="reto-desc">
                        {t.nombre}
                        <span className="reto-status">{t.resultado}</span>
                      </p>
                      <p className="tournament-card-meta">{formatFecha(t.fechaInicio)}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {seccionActiva === "configuracion" && (
        <div className="settings-panel">
          {subseccion === null && (
            <div className="team-panel-menu">
              <button
                type="button"
                className="team-panel-menu-item"
                onClick={() => setSubseccion("apariencia")}
              >
                <span className="team-panel-menu-item-title">Apariencia</span>
                <span className="team-panel-menu-item-desc">Tema del sitio y forma del avatar</span>
              </button>
              <button type="button" className="team-panel-menu-item" onClick={() => setSubseccion("idioma")}>
                <span className="team-panel-menu-item-title">Idioma</span>
                <span className="team-panel-menu-item-desc">Idioma de la interfaz</span>
              </button>
            </div>
          )}

          {subseccion === "apariencia" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubseccion(null)}>
                ← Volver
              </button>
              <p className="tournament-card-meta">
                Elige cómo se ve RemorApp en este dispositivo. La elección se guarda solo en tu navegador.
              </p>
          <div className="pill-radio-group">
            <label className={`pill-radio-option ${tema === "oscuro" ? "selected" : ""}`}>
              <input
                type="radio"
                className="sr-only"
                name="tema-visual"
                checked={tema === "oscuro"}
                onChange={() => setTema("oscuro")}
              />
              Oscuro
            </label>
            <label className={`pill-radio-option ${tema === "claro" ? "selected" : ""}`}>
              <input
                type="radio"
                className="sr-only"
                name="tema-visual"
                checked={tema === "claro"}
                onChange={() => setTema("claro")}
              />
              Claro
            </label>
          </div>

              <h3 className="detail-subtitle">Forma del avatar</h3>
              {errorForma && <div className="form-error">{errorForma}</div>}
              <div className="avatar-forma-options">
                <button
                  type="button"
                  className={`avatar-forma-option ${profile?.avatar_forma === "cuadrado" ? "selected" : ""}`}
                  disabled={guardandoForma}
                  onClick={() => handleCambiarFormaAvatar("cuadrado")}
                >
                  <span className="avatar-forma-preview avatar-shape-cuadrado" />
                  Cuadrado
                </button>
                <button
                  type="button"
                  className={`avatar-forma-option ${profile?.avatar_forma === "redondo" ? "selected" : ""}`}
                  disabled={guardandoForma}
                  onClick={() => handleCambiarFormaAvatar("redondo")}
                >
                  <span className="avatar-forma-preview avatar-shape-redondo" />
                  Redondo
                </button>
              </div>

              {/* catalogo_skins_avatar solo trae filas cuando
                  es_dueno_plataforma() es verdadero (RLS) -- para
                  cualquier otra cuenta, catalogoSkins queda vacío y
                  esta sección directamente no existe, ni gris ni
                  bloqueada. */}
              {catalogoSkins.length > 0 && (
                <div className="skins-exclusivas">
                  <h3 className="detail-subtitle skins-exclusivas-titulo">Skins exclusivas</h3>
                  <p className="tournament-card-meta">
                    Colección del dueño de la plataforma -- todavía no está disponible para el resto de las cuentas.
                  </p>
                  {errorSkin && <div className="form-error">{errorSkin}</div>}
                  <div className="skins-exclusivas-grid">
                    <button
                      type="button"
                      className={`skin-exclusiva-option ${profile?.skin_avatar_activa === null ? "selected" : ""}`}
                      disabled={guardandoSkin}
                      onClick={() => handleActivarSkin(null)}
                    >
                      <span className="skin-exclusiva-preview">
                        <Avatar url={null} nombre={profile?.nick ?? profile?.nombre} className="skin-exclusiva-avatar" />
                      </span>
                      <span className="skin-exclusiva-nombre">Sin skin</span>
                    </button>
                    {catalogoSkins.map((skin) => (
                      <button
                        key={skin.id}
                        type="button"
                        className={`skin-exclusiva-option ${profile?.skin_avatar_activa === skin.id ? "selected" : ""}`}
                        disabled={guardandoSkin}
                        onClick={() => handleActivarSkin(skin.id)}
                        title={skin.descripcion}
                      >
                        <span className="skin-exclusiva-preview">
                          <AvatarSkin clave={skin.clave}>
                            <Avatar url={null} nombre={profile?.nick ?? profile?.nombre} className="skin-exclusiva-avatar" />
                          </AvatarSkin>
                        </span>
                        <span className="skin-exclusiva-nombre">{skin.nombre}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {subseccion === "idioma" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubseccion(null)}>
                ← Volver
              </button>
              <h3 className="detail-subtitle">Idioma</h3>
              {/* Placeholder honesto: no hay ningún sistema de
                  traducción real todavía (es un proyecto aparte, mucho
                  más grande) -- Español es la única opción que de
                  verdad funciona, el resto queda marcado "Próximamente"
                  y deshabilitado, sin fingir que hacen algo. */}
              <div className="form-group">
                <label className="form-label" htmlFor="perfil-idioma">
                  Idioma de la interfaz
                </label>
                <select id="perfil-idioma" className="form-select" value="es" disabled>
                  <option value="es">Español</option>
                </select>
              </div>
              <p className="detail-empty">English, Português y otros idiomas -- Próximamente.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
