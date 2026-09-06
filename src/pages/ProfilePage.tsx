import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { validarNick } from "../lib/nickValidation";
import { recortarImagenConProporcion, recortarImagenCuadrada, obtenerEquipoDelUsuario } from "../lib/teams";
import { formatFecha } from "../lib/formatters";
import { BORDE_HEADER_OPTIONS, COUNTRY_OPTIONS, LIGA_OPTIONS, SC2_REGION_OPTIONS, perfilEstaCompleto } from "../types/profile";
import type { BordeHeader, Country, Liga, LinkTransmision, Sc2Region, Profile } from "../types/profile";
import { RAZA_SC2_OPTIONS } from "../types/juegos";
import type { DatosSc2, RazaSc2 } from "../types/juegos";
import { obtenerJuegoIdSc2 } from "../lib/juegos";
import type { SkinAvatar } from "../types/skins";
import { BORDE_GROSOR_MAX, BORDE_GROSOR_MIN } from "../types/bordes";
import type { BordeBasico } from "../types/bordes";
import Avatar from "../components/Avatar";
import AvatarSkin from "../components/AvatarSkin";
import TitulosActivosList from "../components/TitulosActivosList";
import PercentBar from "../components/PercentBar";

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

// Reorganización del Panel de control: cuadrito principal -> botón
// interno -> formulario interno, mismo patrón anidado de 3 niveles que
// ya usa el Panel de control de /equipos/:tag (team-panel-menu /
// team-panel-menu-item). null en seccionActiva muestra solo los
// cuadritos del Panel de control, sin ningún formulario desparramado
// -- recién al elegir uno se abre su contenido, reemplazando el menú
// (no al lado).
// Reorganización posterior: "Editar datos", "Editar datos de juego" y
// "Configuración" se consolidaron en un solo botón de primer nivel
// ("Configuración"), que ahora contiene los 6 accesos de la
// estructura pedida. Logros y Recompensas / Historial de eventos
// siguen siendo botones de primer nivel aparte -- no se mencionaron en
// ese pedido, así que no se tocaron.
// Nueva reorganización: "Apariencia de Mi perfil" (Subir Avatar / Subir
// Banner / Bordes de Avatar) dejó de ser un acceso de Configuración
// aparte -- ahora vive anidada DENTRO de "Apariencia", junto al Tema y
// al Borde del Header, como una sección más del mismo menú.
// Nueva reorganización: "Estadísticas" (Valentía del jugador,
// Responsabilidad en Torneos y en Clan War) se suma como cuarto botón
// de primer nivel -- esas barras ya no se muestran directo en la
// vitrina pública de Mi perfil (PlayerDetailPage.tsx).
type SeccionPerfil = "estadisticas" | "configuracion" | "logros" | "historial";
const SECCIONES_VALIDAS: SeccionPerfil[] = ["estadisticas", "configuracion", "logros", "historial"];

type SubseccionPerfil =
  | "datos"
  | "transmision"
  | "juegos"
  | "idioma"
  | "apariencia"
  | "titulos"
  | "clan-wars"
  | "torneos"
  | null;

type SubsubseccionPerfil =
  | "titulos-adquiridos"
  | "subir-avatar"
  | "subir-banner"
  | "bordes-avatar"
  | "borde-header"
  | "sc2"
  | null;

function resolverSeccion(valor: string | null): SeccionPerfil | null {
  return SECCIONES_VALIDAS.includes(valor as SeccionPerfil) ? (valor as SeccionPerfil) : null;
}

interface DestinoPerfil {
  seccion: SeccionPerfil | null;
  subseccion: SubseccionPerfil;
  subsubseccion: SubsubseccionPerfil;
}

// "datos" y "juego" son los valores de ?tab= de ANTES de que "Editar
// Datos" y "Configuración por Juegos" pasaran a vivir dentro de
// Configuración -- se resuelven acá como alias hacia su ubicación
// actual (en vez de simplemente descartarse) para que un link o
// marcador viejo siga llevando directo al contenido, en vez de
// rebotar al menú principal del Panel de control.
function resolverDestino(valor: string | null): DestinoPerfil {
  if (valor === "datos") {
    return { seccion: "configuracion", subseccion: "datos", subsubseccion: null };
  }
  if (valor === "juego") {
    return { seccion: "configuracion", subseccion: "juegos", subsubseccion: "sc2" };
  }
  return { seccion: resolverSeccion(valor), subseccion: null, subsubseccion: null };
}

export default function ProfilePage() {
  const { user, profile, skinAvatarClave, bordeBasicoColorHex, loading, refreshProfile } = useAuth();
  const { tema, setTema } = useTheme();
  const location = useLocation();
  // El Panel de control de /jugador/:nick/:uniqueId (vitrina propia)
  // manda acá con ?tab=... -- sin el parámetro (o con cualquier otro
  // valor), arranca mostrando solo los cuadritos del Panel de control.
  const [searchParams] = useSearchParams();
  const destinoInicial = resolverDestino(searchParams.get("tab"));
  const [seccionActiva, setSeccionActiva] = useState<SeccionPerfil | null>(destinoInicial.seccion);
  const [subseccion, setSubseccion] = useState<SubseccionPerfil>(destinoInicial.subseccion);
  const [subsubseccion, setSubsubseccion] = useState<SubsubseccionPerfil>(destinoInicial.subsubseccion);
  // El valor inicial de useState solo se lee en el primer montaje: si
  // ya se está parado en /perfil y se navega de nuevo acá con un ?tab=
  // distinto (el menú de la vitrina usa <Link>, no recarga la página),
  // el componente no se vuelve a montar y la sección se quedaba
  // pegada en la que estaba. Este efecto la resincroniza cada vez que
  // cambia el parámetro de la URL.
  useEffect(() => {
    const destino = resolverDestino(searchParams.get("tab"));
    setSeccionActiva(destino.seccion);
    setSubseccion(destino.subseccion);
    setSubsubseccion(destino.subsubseccion);
  }, [searchParams]);
  // Llega desde LoginPage/RegisterPage cuando alguien con sesión activa
  // intentó entrar o registrarse de nuevo (ver Navigate en esas páginas).
  const avisoRedireccion = (location.state as { aviso?: string } | null)?.aviso ?? null;

  // --- Estadísticas (nuevo botón de primer nivel): solo hace falta
  // saber si el usuario pertenece a un equipo, para decidir si
  // corresponde mostrar "Responsabilidad en Clan War" -- mismo
  // criterio que usaba la vitrina pública antes de que estas barras se
  // movieran para acá.
  const [tieneEquipo, setTieneEquipo] = useState(false);
  useEffect(() => {
    if (!user) return;
    obtenerEquipoDelUsuario(user.id).then((equipo) => setTieneEquipo(!!equipo));
  }, [user]);

  // --- Identidad de jugador: nick y país -- reorganización posterior:
  // servidor SC2 e ID SC2 se mudaron enteros a "Editar Datos del
  // Juego" (junto con el resto de lo específico de StarCraft II), así
  // que ya no forman parte de este formulario. El gate de perfil
  // completo (perfilEstaCompleto()) sigue exigiendo los 4 campos
  // igual que antes -- ahora, completarlo requiere pasar por las dos
  // pantallas en vez de una sola.
  const [nick, setNick] = useState("");
  const [country, setCountry] = useState<Country | "">("");
  const [guardandoIdentidad, setGuardandoIdentidad] = useState(false);
  const [errorIdentidad, setErrorIdentidad] = useState<string | null>(null);
  const [identidadGuardada, setIdentidadGuardada] = useState(false);

  // --- Servidor e ID de StarCraft II: se mudaron acá, junto a raza y
  // liga -- ver handleGuardarDatosJuego() más abajo, que ahora guarda
  // las cuatro cosas juntas. ---
  const [sc2Region, setSc2Region] = useState<Sc2Region | "">("");
  const [sc2Id, setSc2Id] = useState("");
  const [liga, setLiga] = useState<Liga | "">("");

  // --- Contraseña: mismo supabase.auth.updateUser() que usa
  // ResetPasswordPage.tsx, pero con la sesión ya iniciada. Reorganización:
  // ahora pide la contraseña actual primero, como confirmación --
  // supabase-js no tiene una forma directa de "verificar sin cambiar
  // sesión", así que un signInWithPassword exitoso con esa contraseña
  // ES la confirmación (ver handleCambiarPassword). ---
  const [passwordActual, setPasswordActual] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [passwordConfirmar, setPasswordConfirmar] = useState("");
  const [guardandoPassword, setGuardandoPassword] = useState(false);
  const [errorPassword, setErrorPassword] = useState<string | null>(null);
  const [passwordGuardada, setPasswordGuardada] = useState(false);

  // --- Correo de recuperación (migración 061): segundo correo
  // opcional, privado (no viaja con el resto del perfil vía
  // AuthContext) -- se lee con mi_correo_recuperacion() recién al
  // abrir "Editar Datos", no antes. Sirve únicamente para IDENTIFICAR
  // la cuenta en "¿Olvidaste tu contraseña?" cuando el correo
  // principal no coincide con ninguna -- el link de recuperación
  // siempre se manda al correo principal, nunca a este. ---
  const [correoRecuperacion, setCorreoRecuperacion] = useState("");
  const [cargandoCorreoRecuperacion, setCargandoCorreoRecuperacion] = useState(false);
  const [guardandoCorreoRecuperacion, setGuardandoCorreoRecuperacion] = useState(false);
  const [errorCorreoRecuperacion, setErrorCorreoRecuperacion] = useState<string | null>(null);
  const [correoRecuperacionGuardado, setCorreoRecuperacionGuardado] = useState(false);

  // --- Perfil de juego de StarCraft II (migración 034): razas, en
  // perfiles_juego -- opcional, no bloquea cuenta_validada. juegoIdSc2
  // se resuelve una vez y queda guardado para el guardar/cargar. ---
  const [juegoIdSc2, setJuegoIdSc2] = useState<string | null>(null);
  const [razaPrincipal, setRazaPrincipal] = useState<RazaSc2 | "">("");
  const [razaSecundaria, setRazaSecundaria] = useState<RazaSc2 | "">("");
  const [guardandoRaza, setGuardandoRaza] = useState(false);
  const [errorRaza, setErrorRaza] = useState<string | null>(null);
  const [razaGuardada, setRazaGuardada] = useState(false);

  // --- Links (migración 035, con "tipo" agregado en la reorganización
  // del Panel de control): array libre, se edita entero en memoria y
  // se guarda de una sola vez. Los de tipo "personal" (Discord,
  // redes...) se editan en "Editar datos personales"; los de tipo
  // "transmision" (con días y horario) en "Editar datos de
  // transmisión" -- ambos formularios agregan al mismo array, cada
  // uno con sus propios campos de "nuevo link". ---
  const [linksTransmision, setLinksTransmision] = useState<LinkTransmision[]>([]);
  const [nuevaPlataforma, setNuevaPlataforma] = useState("");
  const [nuevaUrlLink, setNuevaUrlLink] = useState("");
  const [nuevaPlataformaTx, setNuevaPlataformaTx] = useState("");
  const [nuevaUrlTx, setNuevaUrlTx] = useState("");
  const [nuevosDiasTx, setNuevosDiasTx] = useState("");
  const [nuevoHorarioTx, setNuevoHorarioTx] = useState("");
  const [guardandoLinks, setGuardandoLinks] = useState(false);
  const [errorLinks, setErrorLinks] = useState<string | null>(null);
  const [linksGuardados, setLinksGuardados] = useState(false);

  // --- "Soy caster": switch independiente de perfil_tipo, se guarda
  // solo al tocarlo (no hace falta un botón "Guardar" aparte). ---
  const [esCaster, setEsCaster] = useState(false);
  const [guardandoCaster, setGuardandoCaster] = useState(false);
  const [errorCaster, setErrorCaster] = useState<string | null>(null);

  // --- Skins de avatar (migración 052): catalogo_skins_avatar solo es
  // legible vía RLS cuando es_dueno_plataforma() es verdadero -- si la
  // consulta vuelve vacía, esta sección no se muestra, sin necesidad
  // de otra verificación aparte. ---
  const [catalogoSkins, setCatalogoSkins] = useState<SkinAvatar[]>([]);
  const [guardandoSkin, setGuardandoSkin] = useState(false);
  const [errorSkin, setErrorSkin] = useState<string | null>(null);

  // --- Borde básico de avatar (migración 055): público y gratuito
  // para cualquier cuenta, a diferencia de las skins de arriba. Elegir
  // un color se aplica al toque (mismo patrón que las skins); el
  // grosor es lo único que se ajusta en el slider antes de guardar --
  // grosorSeleccionado es ese estado LOCAL, todavía sin guardar. ---
  const [catalogoBordes, setCatalogoBordes] = useState<BordeBasico[]>([]);
  const [grosorSeleccionado, setGrosorSeleccionado] = useState(3);
  const [guardandoBorde, setGuardandoBorde] = useState(false);
  const [errorBorde, setErrorBorde] = useState<string | null>(null);
  const [bordeGuardado, setBordeGuardado] = useState(false);

  // --- Borde del header (migración 056): sistema aparte, mucho más
  // simple -- 4 colores fijos, se aplica al toque, sin grosor. ---
  const [guardandoBordeHeader, setGuardandoBordeHeader] = useState(false);
  const [errorBordeHeader, setErrorBordeHeader] = useState<string | null>(null);

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
    setPerfilBio(profile.bio ?? "");
  }, [profile]);

  // Correo de recuperación (migración 061): privado, no viaja con el
  // resto del perfil -- se resuelve aparte con mi_correo_recuperacion().
  useEffect(() => {
    if (!user) return;
    setCargandoCorreoRecuperacion(true);
    supabase.rpc("mi_correo_recuperacion").then(({ data, error }) => {
      setCargandoCorreoRecuperacion(false);
      if (error) {
        console.error("Error cargando el correo de recuperación:", error);
        return;
      }
      setCorreoRecuperacion(data ?? "");
    });
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

  // Público (sin RLS restrictiva, a diferencia del catálogo de
  // arriba): se carga siempre, para cualquier cuenta.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("catalogo_bordes_basicos")
        .select("id, nombre, color_hex")
        .order("nombre");
      setCatalogoBordes((data as BordeBasico[] | null) ?? []);
    })();
  }, []);

  // El estado local de la vista previa se sincroniza con el perfil
  // cada vez que llega (o cambia tras guardar) -- mismo patrón que el
  // resto de los campos de "Editar datos".
  useEffect(() => {
    if (!profile) return;
    setGrosorSeleccionado(profile.borde_grosor);
  }, [profile]);

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

  // Reorganización: solo nick y país -- servidor/ID de SC2 se guardan
  // ahora en handleGuardarDatosJuego(), junto con raza y liga.
  const handleGuardarIdentidad = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const errorNick = validarNick(nick);
    if (errorNick) {
      setErrorIdentidad(errorNick);
      return;
    }
    if (!country) {
      setErrorIdentidad("Debes completar todos los campos.");
      return;
    }

    setGuardandoIdentidad(true);
    setErrorIdentidad(null);
    setIdentidadGuardada(false);

    // cuenta_validada no se manda: se recalcula sola en la base
    // (trigger actualizar_cuenta_validada) a partir de los 4 campos
    // obligatorios -- nick y country se guardan acá, sc2_region/sc2_id
    // en "Editar Datos del Juego", así que el perfil recién queda
    // completo cuando se pasó por las dos pantallas.
    const { error: updateError } = await supabase.from("profiles").update({ nick, country }).eq("id", user.id);

    setGuardandoIdentidad(false);

    if (updateError) {
      setErrorIdentidad(updateError.message);
      return;
    }

    await refreshProfile();
    setIdentidadGuardada(true);
  };

  // Reorganización: pide la contraseña ACTUAL primero, como
  // confirmación -- supabase-js no tiene una forma directa de
  // "verificar sin cambiar la sesión", así que un signInWithPassword
  // exitoso con esa contraseña es, en los hechos, la confirmación (es
  // la misma cuenta, mismo correo, y si la contraseña actual fuera
  // incorrecta esa llamada falla antes de tocar nada).
  const handleCambiarPassword = async (event: FormEvent) => {
    event.preventDefault();
    setErrorPassword(null);
    setPasswordGuardada(false);

    if (!passwordActual) {
      setErrorPassword("Ingresa tu contraseña actual para confirmar el cambio.");
      return;
    }
    if (passwordNueva.length < 6) {
      setErrorPassword("La contraseña tiene que tener al menos 6 caracteres.");
      return;
    }
    if (passwordNueva !== passwordConfirmar) {
      setErrorPassword("Las dos contraseñas no coinciden.");
      return;
    }
    if (!user?.email) return;

    setGuardandoPassword(true);

    const { error: verificarError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: passwordActual,
    });

    if (verificarError) {
      setGuardandoPassword(false);
      setErrorPassword("Tu contraseña actual no es correcta.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: passwordNueva });
    setGuardandoPassword(false);

    if (error) {
      setErrorPassword(error.message);
      return;
    }

    setPasswordActual("");
    setPasswordNueva("");
    setPasswordConfirmar("");
    setPasswordGuardada(true);
  };

  // Correo de recuperación (migración 061): privado, se guarda con una
  // RPC (guardar_correo_recuperacion()) en vez de un update directo --
  // la columna no tiene grant de select/update para authenticated,
  // mismo criterio que profiles.email.
  const handleGuardarCorreoRecuperacion = async (event: FormEvent) => {
    event.preventDefault();
    setErrorCorreoRecuperacion(null);
    setCorreoRecuperacionGuardado(false);

    setGuardandoCorreoRecuperacion(true);
    const { error } = await supabase.rpc("guardar_correo_recuperacion", {
      p_correo: correoRecuperacion.trim() || null,
    });
    setGuardandoCorreoRecuperacion(false);

    if (error) {
      setErrorCorreoRecuperacion(error.message);
      return;
    }

    setCorreoRecuperacionGuardado(true);
  };

  // Migración 048, extendida en la reorganización posterior: servidor
  // e ID de SC2 (profiles), raza principal/secundaria (perfiles_juego)
  // y liga (profiles) se guardan juntas con un solo botón -- las
  // cuatro son "datos de juego" de StarCraft II, aunque vivan en dos
  // tablas distintas.
  const handleGuardarDatosJuego = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !juegoIdSc2) return;

    if (!sc2Region || !sc2Id.trim()) {
      setErrorRaza("Debes completar el servidor y el ID de StarCraft II.");
      return;
    }

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

    // sc2_region/sc2_id/liga son de profiles, no de perfiles_juego --
    // se guardan en el mismo envío para que "Editar Datos del Juego"
    // tenga un solo botón.
    const { error: errorProfile } = await supabase
      .from("profiles")
      .update({ sc2_region: sc2Region, sc2_id: sc2Id.trim(), liga: liga || null })
      .eq("id", user.id);

    setGuardandoRaza(false);

    if (errorProfile) {
      setErrorRaza(errorProfile.message);
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
    setLinksTransmision((prev) => [
      ...prev,
      { plataforma: nuevaPlataforma.trim(), url: nuevaUrlLink.trim(), tipo: "personal" },
    ]);
    setNuevaPlataforma("");
    setNuevaUrlLink("");
  };

  const handleAgregarLinkTransmision = () => {
    if (!nuevaPlataformaTx.trim() || !nuevaUrlTx.trim()) {
      setErrorLinks("Completa la plataforma y el link.");
      return;
    }

    setErrorLinks(null);
    setLinksGuardados(false);
    setLinksTransmision((prev) => [
      ...prev,
      {
        plataforma: nuevaPlataformaTx.trim(),
        url: nuevaUrlTx.trim(),
        tipo: "transmision",
        dias: nuevosDiasTx.trim() || undefined,
        horario: nuevoHorarioTx.trim() || undefined,
      },
    ]);
    setNuevaPlataformaTx("");
    setNuevaUrlTx("");
    setNuevosDiasTx("");
    setNuevoHorarioTx("");
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
      .update({ links_transmision: linksTransmision })
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

  // "Bordes de Avatar" es una sola lista (borde básico + skins de
  // efectos): elegir cualquiera de las dos cosas apaga la otra --
  // nunca quedan las dos activas a la vez, aunque la prioridad visual
  // (si por algún motivo quedaran las dos escritas) ya está resuelta
  // en AvatarSkin.tsx a favor de la skin.
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

    if (skinId !== null && profile?.borde_basico_activo) {
      await supabase.from("profiles").update({ borde_basico_activo: null }).eq("id", user.id);
    }

    await refreshProfile();
  };

  const handleElegirBordeBasico = async (bordeId: string | null) => {
    if (!user || bordeId === profile?.borde_basico_activo) return;

    setGuardandoBorde(true);
    setErrorBorde(null);
    setBordeGuardado(false);

    const { error } = await supabase
      .from("profiles")
      .update({ borde_basico_activo: bordeId, borde_grosor: grosorSeleccionado })
      .eq("id", user.id);

    setGuardandoBorde(false);

    if (error) {
      setErrorBorde(error.message);
      return;
    }

    if (bordeId !== null && profile?.skin_avatar_activa) {
      await supabase.rpc("activar_skin_avatar", { p_skin_id: null });
    }

    await refreshProfile();
  };

  const handleGuardarGrosor = async () => {
    if (!user) return;

    setGuardandoBorde(true);
    setErrorBorde(null);
    setBordeGuardado(false);

    const { error } = await supabase
      .from("profiles")
      .update({ borde_grosor: grosorSeleccionado })
      .eq("id", user.id);

    setGuardandoBorde(false);

    if (error) {
      setErrorBorde(error.message);
      return;
    }

    await refreshProfile();
    setBordeGuardado(true);
  };

  const handleGuardarBordeHeader = async (valor: BordeHeader) => {
    if (!user || valor === profile?.borde_header) return;

    setGuardandoBordeHeader(true);
    setErrorBordeHeader(null);

    const { error } = await supabase.from("profiles").update({ borde_header: valor }).eq("id", user.id);

    setGuardandoBordeHeader(false);

    if (error) {
      setErrorBordeHeader(error.message);
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

      {/* Las barras de Valentía/Responsabilidad ya no se muestran
          directo en la vitrina pública (/jugador/:nick/:uniqueId,
          "Mi perfil" en la barra inferior) -- viven acá, dentro del
          botón "Estadísticas", igual que el resto del Panel de
          control. */}
      <h2 className="detail-subtitle">Panel de control</h2>
      {seccionActiva === null ? (
        <div className="team-panel-menu">
          <button
            type="button"
            className="team-panel-menu-item"
            onClick={() => setSeccionActiva("estadisticas")}
          >
            <span className="team-panel-menu-item-title">Estadísticas</span>
            <span className="team-panel-menu-item-desc">
              Valentía del jugador y Responsabilidad en Torneos y Clan War
            </span>
          </button>
          <button
            type="button"
            className="team-panel-menu-item"
            onClick={() => setSeccionActiva("configuracion")}
          >
            <span className="team-panel-menu-item-title">Configuración</span>
            <span className="team-panel-menu-item-desc">
              Datos, transmisión, apariencia, juegos e idioma
            </span>
          </button>
          <button
            type="button"
            className="team-panel-menu-item"
            onClick={() => setSeccionActiva("logros")}
          >
            <span className="team-panel-menu-item-title">Logros</span>
            <span className="team-panel-menu-item-desc">Títulos Padre/Hijo activos, pendientes y adquiridos</span>
          </button>
          <button
            type="button"
            className="team-panel-menu-item"
            onClick={() => setSeccionActiva("historial")}
          >
            <span className="team-panel-menu-item-title">Historial de eventos</span>
            <span className="team-panel-menu-item-desc">Clan Wars y torneos en los que participaste</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="team-panel-back"
          onClick={() => {
            setSeccionActiva(null);
            setSubseccion(null);
            setSubsubseccion(null);
          }}
        >
          ← Volver al panel
        </button>
      )}

      {/* Estadísticas: Valentía del jugador y Responsabilidad en
          Torneos/Clan War, sacadas de la vitrina pública de Mi perfil.
          Responsabilidad en Clan War solo se muestra si el usuario
          pertenece a un equipo -- mismo criterio que tenía antes en
          PlayerDetailPage.tsx. */}
      {seccionActiva === "estadisticas" && (
        <div className="settings-panel stats-card-group">
          <PercentBar label="Valentía del jugador" value={profile?.valentia_jugador ?? 0} vertical />
          <PercentBar label="Responsabilidad en Torneos" value={profile?.responsabilidad_torneos ?? 0} vertical />
          {tieneEquipo && (
            <PercentBar label="Responsabilidad en Clan War" value={profile?.responsabilidad_cw ?? 0} vertical />
          )}
        </div>
      )}

      {/* Reorganización: "Editar datos", "Editar datos de juego" y
          "Configuración" se consolidaron acá adentro -- los 5 accesos
          de la estructura actual (Editar Datos / Editar Datos de
          Transmisión / Configuración por Juegos / Cambiar idioma
          general / Apariencia). "Apariencia de Mi perfil" ya no es un
          acceso aparte: sus 3 opciones viven anidadas dentro de
          Apariencia. */}
      {seccionActiva === "configuracion" && (
        <div className="settings-panel">
          {subseccion === null && (
            <div className="team-panel-menu">
              <button type="button" className="team-panel-menu-item" onClick={() => setSubseccion("datos")}>
                <span className="team-panel-menu-item-title">Editar Datos</span>
                <span className="team-panel-menu-item-desc">
                  Nick, contraseña, país y correo de recuperación
                </span>
              </button>
              <button
                type="button"
                className="team-panel-menu-item"
                onClick={() => setSubseccion("transmision")}
              >
                <span className="team-panel-menu-item-title">Editar Datos de Transmisión</span>
                <span className="team-panel-menu-item-desc">
                  Plataformas donde transmitís, con días y horarios
                </span>
              </button>
              <button type="button" className="team-panel-menu-item" onClick={() => setSubseccion("juegos")}>
                <span className="team-panel-menu-item-title">Editar Datos del Juego</span>
                <span className="team-panel-menu-item-desc">
                  Links, servidor e ID de SC2, raza principal, secundaria y liga
                </span>
              </button>
              <button type="button" className="team-panel-menu-item" onClick={() => setSubseccion("idioma")}>
                <span className="team-panel-menu-item-title">Cambiar idioma general</span>
                <span className="team-panel-menu-item-desc">Idioma de la interfaz</span>
              </button>
              <button
                type="button"
                className="team-panel-menu-item"
                onClick={() => setSubseccion("apariencia")}
              >
                <span className="team-panel-menu-item-title">Apariencia</span>
                <span className="team-panel-menu-item-desc">
                  Tema del sitio, avatar, banner y bordes de avatar y del header
                </span>
              </button>
            </div>
          )}

          {subseccion === "datos" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubseccion(null)}>
                ← Volver
              </button>

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

                <button type="submit" className="btn btn-primary btn-block" disabled={guardandoIdentidad}>
                  {guardandoIdentidad ? "Guardando..." : "Guardar"}
                </button>
              </form>

              {/* Correo electrónico: ya no se edita acá -- reorganización.
                  Se muestra de solo lectura, viene directo de la sesión
                  (auth.users), no de profiles. Cambiarlo dejó de ser
                  parte de esta pantalla; si hace falta recuperarlo, ver
                  el correo de recuperación más abajo. */}
              <h3 className="detail-subtitle">Correo electrónico</h3>
              <p className="tournament-card-meta">{user?.email}</p>

              <h3 className="detail-subtitle">Contraseña</h3>
              <form className="auth-form" onSubmit={handleCambiarPassword}>
                {errorPassword && <div className="form-error">{errorPassword}</div>}
                {passwordGuardada && <div className="form-success">Tu contraseña se cambió correctamente.</div>}

                <div className="form-group">
                  <label className="form-label" htmlFor="perfil-password-actual">
                    Contraseña actual
                  </label>
                  <input
                    id="perfil-password-actual"
                    className="form-input"
                    type="password"
                    value={passwordActual}
                    onChange={(e) => setPasswordActual(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="perfil-password-nueva">
                    Contraseña nueva
                  </label>
                  <input
                    id="perfil-password-nueva"
                    className="form-input"
                    type="password"
                    minLength={6}
                    value={passwordNueva}
                    onChange={(e) => setPasswordNueva(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="perfil-password-confirmar">
                    Repite la contraseña nueva
                  </label>
                  <input
                    id="perfil-password-confirmar"
                    className="form-input"
                    type="password"
                    minLength={6}
                    value={passwordConfirmar}
                    onChange={(e) => setPasswordConfirmar(e.target.value)}
                  />
                </div>

                <button type="submit" className="btn btn-ghost btn-block" disabled={guardandoPassword}>
                  {guardandoPassword ? "Guardando..." : "Cambiar contraseña"}
                </button>
              </form>

              <h3 className="detail-subtitle">Correo de recuperación (opcional)</h3>
              <p className="tournament-card-meta">
                Un segundo correo, solo para identificar tu cuenta en "¿Olvidaste tu contraseña?" si
                alguna vez perdés acceso al principal -- el link de recuperación siempre se manda al
                correo principal, nunca a este.
              </p>
              <form className="auth-form" onSubmit={handleGuardarCorreoRecuperacion}>
                {errorCorreoRecuperacion && <div className="form-error">{errorCorreoRecuperacion}</div>}
                {correoRecuperacionGuardado && (
                  <div className="form-success">Tu correo de recuperación se guardó correctamente.</div>
                )}
                <div className="form-group">
                  <label className="form-label" htmlFor="perfil-correo-recuperacion">
                    Correo de recuperación
                  </label>
                  <input
                    id="perfil-correo-recuperacion"
                    className="form-input"
                    type="email"
                    placeholder="otro-correo@ejemplo.com"
                    value={correoRecuperacion}
                    disabled={cargandoCorreoRecuperacion}
                    onChange={(e) => setCorreoRecuperacion(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-ghost btn-block"
                  disabled={guardandoCorreoRecuperacion || cargandoCorreoRecuperacion}
                >
                  {guardandoCorreoRecuperacion ? "Guardando..." : "Guardar correo de recuperación"}
                </button>
              </form>
            </>
          )}

          {subseccion === "transmision" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubseccion(null)}>
                ← Volver
              </button>

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

              <h3 className="detail-subtitle">Plataformas de transmisión</h3>
              {errorLinks && <div className="form-error">{errorLinks}</div>}
              {linksGuardados && <div className="form-success">Tus links se guardaron correctamente.</div>}

              {linksTransmision.filter((link) => link.tipo === "transmision").length > 0 && (
                <div className="detail-participant-list">
                  {linksTransmision
                    .map((link, indice) => ({ link, indice }))
                    .filter(({ link }) => link.tipo === "transmision")
                    .map(({ link, indice }) => (
                      <div key={indice} className="reto-item">
                        <p className="reto-desc">
                          {link.plataforma}
                          <span className="profile-nick-id">{link.url}</span>
                        </p>
                        {(link.dias || link.horario) && (
                          <p className="tournament-card-meta">
                            {[link.dias, link.horario].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        <button type="button" className="btn btn-ghost" onClick={() => handleQuitarLink(indice)}>
                          Quitar
                        </button>
                      </div>
                    ))}
                </div>
              )}

              <div className="auth-form">
                <div className="form-group">
                  <label className="form-label" htmlFor="perfil-tx-plataforma">
                    Plataforma
                  </label>
                  <input
                    id="perfil-tx-plataforma"
                    className="form-input"
                    type="text"
                    placeholder="Twitch, YouTube, Kick..."
                    value={nuevaPlataformaTx}
                    onChange={(e) => setNuevaPlataformaTx(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="perfil-tx-url">
                    Link del canal
                  </label>
                  <input
                    id="perfil-tx-url"
                    className="form-input"
                    type="text"
                    placeholder="https://twitch.tv/tu-canal"
                    value={nuevaUrlTx}
                    onChange={(e) => setNuevaUrlTx(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="perfil-tx-dias">
                    Qué días transmitís (opcional)
                  </label>
                  <input
                    id="perfil-tx-dias"
                    className="form-input"
                    type="text"
                    placeholder="Ej: Martes y jueves"
                    value={nuevosDiasTx}
                    onChange={(e) => setNuevosDiasTx(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="perfil-tx-horario">
                    A qué hora (opcional)
                  </label>
                  <input
                    id="perfil-tx-horario"
                    className="form-input"
                    type="text"
                    placeholder="Ej: 20:00 (hora Chile)"
                    value={nuevoHorarioTx}
                    onChange={(e) => setNuevoHorarioTx(e.target.value)}
                  />
                </div>
                <button type="button" className="btn btn-ghost btn-block" onClick={handleAgregarLinkTransmision}>
                  Agregar plataforma
                </button>

                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={guardandoLinks}
                  onClick={handleGuardarLinks}
                >
                  {guardandoLinks ? "Guardando..." : "Guardar links"}
                </button>
              </div>
            </>
          )}

          {subseccion === "apariencia" && subsubseccion === "subir-avatar" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubsubseccion(null)}>
                ← Volver
              </button>

              {/* La forma ya no es elegible: en Mi perfil (esta vista
                  previa) el avatar es SIEMPRE cuadrado -- en el header
                  es siempre redondo (ver Header.tsx). */}
              <div className="profile-avatar-section">
                <AvatarSkin
                  clave={skinAvatarClave}
                  bordeColor={bordeBasicoColorHex}
                  bordeGrosor={profile?.borde_grosor}
                  forma="cuadrado"
                >
                  <Avatar
                    url={avatarPreview ?? profile?.avatar_url}
                    nombre={profile?.nick ?? profile?.nombre}
                    className="profile-avatar"
                    forma="cuadrado"
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
            </>
          )}

          {subseccion === "apariencia" && subsubseccion === "subir-banner" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubsubseccion(null)}>
                ← Volver
              </button>
              <h3 className="detail-subtitle">Banner y descripción</h3>
              <form className="auth-form" onSubmit={handleGuardarPerfilPublico}>
                {errorPerfilPublico && <div className="form-error">{errorPerfilPublico}</div>}
                {perfilPublicoGuardado && (
                  <div className="form-success">Tu perfil público se guardó correctamente.</div>
                )}

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
            </>
          )}

          {subseccion === "apariencia" && subsubseccion === "bordes-avatar" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubsubseccion(null)}>
                ← Volver
              </button>
              <h3 className="detail-subtitle">Bordes de Avatar</h3>
              <p className="tournament-card-meta">
                Elegir un borde básico o una skin de efectos apaga la otra opción -- nunca quedan las dos
                activas a la vez.
              </p>

              <div className="profile-avatar-section">
                <AvatarSkin
                  clave={skinAvatarClave}
                  bordeColor={bordeBasicoColorHex}
                  bordeGrosor={grosorSeleccionado}
                  forma="cuadrado"
                >
                  <Avatar
                    url={profile?.avatar_url}
                    nombre={profile?.nick ?? profile?.nombre}
                    className="profile-avatar"
                    forma="cuadrado"
                  />
                </AvatarSkin>
              </div>

              {errorBorde && <div className="form-error">{errorBorde}</div>}
              {errorSkin && <div className="form-error">{errorSkin}</div>}
              {bordeGuardado && <div className="form-success">Tu borde se guardó correctamente.</div>}

              <h4 className="detail-subtitle">Bordes básicos de color</h4>
              <div className="borde-basico-options">
                <button
                  type="button"
                  className={`borde-basico-swatch borde-basico-swatch-vacio ${
                    profile?.borde_basico_activo === null && profile?.skin_avatar_activa === null ? "selected" : ""
                  }`}
                  disabled={guardandoBorde}
                  onClick={() => handleElegirBordeBasico(null)}
                  title="Sin borde"
                >
                  <span className="borde-basico-swatch-nombre">Sin borde</span>
                </button>
                {catalogoBordes.map((borde) => (
                  <button
                    key={borde.id}
                    type="button"
                    className={`borde-basico-swatch ${profile?.borde_basico_activo === borde.id ? "selected" : ""}`}
                    style={{ backgroundColor: borde.color_hex }}
                    disabled={guardandoBorde}
                    onClick={() => handleElegirBordeBasico(borde.id)}
                    title={borde.nombre}
                  />
                ))}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="perfil-borde-grosor">
                  Grosor del borde ({grosorSeleccionado}px)
                </label>
                <input
                  id="perfil-borde-grosor"
                  className="form-range"
                  type="range"
                  min={BORDE_GROSOR_MIN}
                  max={BORDE_GROSOR_MAX}
                  value={grosorSeleccionado}
                  onChange={(e) => setGrosorSeleccionado(Number(e.target.value))}
                  disabled={profile?.borde_basico_activo == null}
                />
              </div>

              <button
                type="button"
                className="btn btn-ghost btn-block"
                disabled={guardandoBorde || profile?.borde_basico_activo == null}
                onClick={handleGuardarGrosor}
              >
                {guardandoBorde ? "Guardando..." : "Guardar grosor"}
              </button>

              {/* catalogo_skins_avatar solo trae filas cuando
                  es_dueno_plataforma() es verdadero (RLS) -- para
                  cualquier otra cuenta, catalogoSkins queda vacío y
                  esta sección directamente no existe, ni gris ni
                  bloqueada. */}
              {catalogoSkins.length > 0 && (
                <div className="skins-exclusivas">
                  <h4 className="detail-subtitle skins-exclusivas-titulo">Skins de efectos</h4>
                  <p className="tournament-card-meta">
                    Colección del dueño de la plataforma -- todavía no está disponible para el resto de las
                    cuentas.
                  </p>
                  <div className="skins-exclusivas-grid">
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

          {subseccion === "juegos" && subsubseccion === null && (
            <div className="team-panel-menu">
              <button type="button" className="team-panel-back" onClick={() => setSubseccion(null)}>
                ← Volver
              </button>
              {/* Selector de juego (migración 048): por ahora solo
                  StarCraft II está activo -- perfiles_juego ya está
                  preparada para más juegos (juego_id genérico), acá
                  solo hace falta agregar un botón análogo a este el
                  día que exista un segundo juego, sin tocar el
                  esquema. */}
              <button
                type="button"
                className="team-panel-menu-item"
                onClick={() => setSubsubseccion("sc2")}
              >
                <span className="team-panel-menu-item-title">StarCraft II</span>
                <span className="team-panel-menu-item-desc">
                  Links, servidor, ID, raza principal, secundaria y liga
                </span>
              </button>
            </div>
          )}

          {subseccion === "juegos" && subsubseccion === "sc2" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubsubseccion(null)}>
                ← Volver
              </button>
              <h3 className="detail-subtitle">StarCraft II</h3>
              <p className="tournament-card-meta">
                Estos datos se ven en el roster de tu equipo, junto al resto de tus compañeros.
              </p>

              {/* Links de presencia general (Discord, redes...), sin
                  horario -- los de transmisión (con días y horario) se
                  editan aparte, en "Editar Datos de Transmisión".
                  Reorganización: se mudaron acá enteros desde "Editar
                  Datos". */}
              <h3 className="detail-subtitle">Links (Discord, YouTube...)</h3>
              {errorLinks && <div className="form-error">{errorLinks}</div>}
              {linksGuardados && <div className="form-success">Tus links se guardaron correctamente.</div>}

              {linksTransmision.filter((link) => (link.tipo ?? "personal") === "personal").length > 0 && (
                <div className="detail-participant-list">
                  {linksTransmision
                    .map((link, indice) => ({ link, indice }))
                    .filter(({ link }) => (link.tipo ?? "personal") === "personal")
                    .map(({ link, indice }) => (
                      <div key={indice} className="detail-participant-item">
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
                    placeholder="Discord, YouTube..."
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
                    placeholder="https://discord.gg/tu-server"
                    value={nuevaUrlLink}
                    onChange={(e) => setNuevaUrlLink(e.target.value)}
                  />
                </div>
                <button type="button" className="btn btn-ghost btn-block" onClick={handleAgregarLink}>
                  Agregar link
                </button>

                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={guardandoLinks}
                  onClick={handleGuardarLinks}
                >
                  {guardandoLinks ? "Guardando..." : "Guardar links"}
                </button>
              </div>

              <form className="auth-form" onSubmit={handleGuardarDatosJuego}>
                {errorRaza && <div className="form-error">{errorRaza}</div>}
                {razaGuardada && <div className="form-success">Tus datos de juego se guardaron correctamente.</div>}

                {/* Servidor e ID de StarCraft II: reorganización --
                    se mudaron acá desde "Editar Datos". */}
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

          {subseccion === "apariencia" && subsubseccion === null && (
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

              <div className="team-panel-menu">
                <button
                  type="button"
                  className="team-panel-menu-item"
                  onClick={() => setSubsubseccion("subir-avatar")}
                >
                  <span className="team-panel-menu-item-title">Subir Avatar</span>
                  <span className="team-panel-menu-item-desc">Foto de perfil</span>
                </button>
                <button
                  type="button"
                  className="team-panel-menu-item"
                  onClick={() => setSubsubseccion("subir-banner")}
                >
                  <span className="team-panel-menu-item-title">Subir Banner</span>
                  <span className="team-panel-menu-item-desc">Portada y descripción</span>
                </button>
                <button
                  type="button"
                  className="team-panel-menu-item"
                  onClick={() => setSubsubseccion("bordes-avatar")}
                >
                  <span className="team-panel-menu-item-title">Bordes de Avatar</span>
                  <span className="team-panel-menu-item-desc">
                    Bordes básicos de color y, si corresponde, skins de efectos
                  </span>
                </button>
                <button
                  type="button"
                  className="team-panel-menu-item"
                  onClick={() => setSubsubseccion("borde-header")}
                >
                  <span className="team-panel-menu-item-title">Borde del Header</span>
                  <span className="team-panel-menu-item-desc">4 colores lisos, exclusivo del avatar del header</span>
                </button>
              </div>
            </>
          )}

          {subseccion === "apariencia" && subsubseccion === "borde-header" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubsubseccion(null)}>
                ← Volver
              </button>
              <h3 className="detail-subtitle">Borde del Header</h3>
              <p className="tournament-card-meta">
                Sistema aparte de los Bordes de Avatar de Mi perfil -- solo 4 colores lisos, sin grosor
                editable, exclusivo del avatar del header.
              </p>

              <span
                className="header-avatar-borde"
                style={{
                  borderColor: BORDE_HEADER_OPTIONS.find((o) => o.value === (profile?.borde_header ?? "negro"))
                    ?.colorHex,
                }}
              >
                <Avatar
                  url={profile?.avatar_url}
                  nombre={profile?.nick ?? profile?.nombre}
                  className="header-avatar"
                  forma="redondo"
                />
              </span>

              {errorBordeHeader && <div className="form-error">{errorBordeHeader}</div>}

              <div className="borde-basico-options">
                {BORDE_HEADER_OPTIONS.map((opcion) => (
                  <button
                    key={opcion.value}
                    type="button"
                    className={`borde-basico-swatch ${profile?.borde_header === opcion.value ? "selected" : ""}`}
                    style={{ backgroundColor: opcion.colorHex }}
                    disabled={guardandoBordeHeader}
                    onClick={() => handleGuardarBordeHeader(opcion.value)}
                    title={opcion.label}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {seccionActiva === "logros" && (
        <div className="settings-panel">
          {subseccion === null && (
            <div className="team-panel-menu">
              <button
                type="button"
                className="team-panel-menu-item"
                onClick={() => setSubseccion("titulos")}
              >
                <span className="team-panel-menu-item-title">Títulos</span>
                <span className="team-panel-menu-item-desc">
                  Títulos Padre/Hijo activos, pendientes, propuestas y títulos adquiridos
                </span>
              </button>
            </div>
          )}

          {subseccion === "titulos" && subsubseccion === null && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubseccion(null)}>
                ← Volver
              </button>

              <h3 className="detail-subtitle">Títulos Padre/Hijo</h3>
              <p className="tournament-card-meta">
                Se resuelven solos cuando ganas o pierdes una partida 1v1 real contra el rival, en
                cualquier torneo.
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

              <div className="team-panel-menu">
                <button
                  type="button"
                  className="team-panel-menu-item"
                  onClick={() => {
                    setSubsubseccion("titulos-adquiridos");
                    cargarGestorTitulos();
                  }}
                >
                  <span className="team-panel-menu-item-title">Títulos adquiridos</span>
                  <span className="team-panel-menu-item-desc">
                    Cuántas veces ganaste o perdiste un título Padre/Hijo, y de quién
                  </span>
                </button>
              </div>
            </>
          )}

          {subseccion === "titulos" && subsubseccion === "titulos-adquiridos" && (
            <>
              <button type="button" className="team-panel-back" onClick={() => setSubsubseccion(null)}>
                ← Volver
              </button>
              <h3 className="detail-subtitle">Títulos adquiridos</h3>
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

    </section>
  );
}
