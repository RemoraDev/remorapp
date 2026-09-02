import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { calcularNivelLineal } from "../lib/ligas";
import { construirGaleria } from "../lib/hallOfFame";
import type { EventoGaleria } from "../lib/hallOfFame";
import { formatFecha } from "../lib/formatters";
import type { TituloActivoTodos } from "../types/titulos";

// Un solo juego real por ahora -- la estructura ya queda lista como
// array para agregar más adelante, sin construir salas vacías todavía
// para los que no existen.
const JUEGOS = [{ id: "sc2", nombre: "StarCraft II" }] as const;

interface TituloResuelto {
  otroId: string;
  soyPadre: boolean;
}

interface CampeonFila {
  id: string;
  tag: string;
  nombre: string;
  liga: string;
  mmr: number;
  nivel: number;
  titulo: string | null;
}

interface JugadorFila {
  id: string;
  nick: string;
  uniqueId: string;
  liga: string;
  nivel: number;
  valentia: number;
  responsabilidad: number;
  titulo: string | null;
}

// El título más "importante" cuando hay varios activos a la vez: el
// de mayor duracion_dias, tal como se pidió (criterio simple).
function tituloMasRelevante(id: string, titulos: TituloActivoTodos[]): TituloResuelto | null {
  const propios = titulos.filter((t) => t.retador_id === id || t.retado_id === id);
  if (propios.length === 0) return null;
  const elegido = [...propios].sort((a, b) => b.duracion_dias - a.duracion_dias)[0];
  return {
    otroId: elegido.retador_id === id ? elegido.retado_id : elegido.retador_id,
    soyPadre: elegido.ganador_id === id,
  };
}

export default function HallOfFamePage() {
  const [juegoActivo, setJuegoActivo] = useState<string>(JUEGOS[0].id);

  const [campeones, setCampeones] = useState<CampeonFila[]>([]);
  const [jugadores, setJugadores] = useState<JugadorFila[]>([]);
  const [cargandoMuros, setCargandoMuros] = useState(true);

  const [galeria, setGaleria] = useState<EventoGaleria[]>([]);
  const [cargandoGaleria, setCargandoGaleria] = useState(true);

  // --- Filtros de la galería ---
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [filtroTag, setFiltroTag] = useState("");
  const [filtroNick, setFiltroNick] = useState("");
  const [idClanFiltro, setIdClanFiltro] = useState<string | null>(null);
  const [idJugadorFiltro, setIdJugadorFiltro] = useState<string | null>(null);
  const [nombreClanFiltro, setNombreClanFiltro] = useState<string | null>(null);
  const [nombreJugadorFiltro, setNombreJugadorFiltro] = useState<string | null>(null);
  const [errorFiltro, setErrorFiltro] = useState<string | null>(null);

  useEffect(() => {
    if (juegoActivo !== "sc2") return;

    const cargarMuros = async () => {
      setCargandoMuros(true);

      const [{ data: equiposData }, { data: titulosClanData }] = await Promise.all([
        supabase
          .from("teams")
          .select("id, name, tag, mmr, liga")
          .eq("disuelto", false)
          .order("mmr", { ascending: false })
          .limit(100),
        supabase.rpc("titulos_activos_todos", { p_tipo: "clan" }),
      ]);

      const titulosClan = (titulosClanData ?? []) as TituloActivoTodos[];
      const equipos = equiposData ?? [];

      const otrosIdsClan = equipos
        .map((e) => tituloMasRelevante(e.id, titulosClan))
        .filter((t): t is TituloResuelto => t !== null)
        .map((t) => t.otroId);

      let tagPorTeamId: Record<string, string> = {};
      if (otrosIdsClan.length > 0) {
        const { data: otrosEquipos } = await supabase.from("teams").select("id, tag").in("id", otrosIdsClan);
        tagPorTeamId = Object.fromEntries((otrosEquipos ?? []).map((t) => [t.id, t.tag]));
      }

      setCampeones(
        equipos.map((e) => {
          const t = tituloMasRelevante(e.id, titulosClan);
          return {
            id: e.id,
            tag: e.tag,
            nombre: e.name,
            liga: e.liga,
            mmr: e.mmr,
            nivel: calcularNivelLineal(e.mmr),
            titulo: t ? `${t.soyPadre ? "Padre" : "Hijo"} de ${tagPorTeamId[t.otroId] ?? "?"}` : null,
          };
        })
      );

      const [{ data: perfilesData }, { data: titulosJugadorData }] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, nick, unique_id, mmr_1v1, liga_1v1, nivel_1v1, valentia_jugador, responsabilidad_cw, suspendido"
          )
          .order("mmr_1v1", { ascending: false })
          .limit(100),
        supabase.rpc("titulos_activos_todos", { p_tipo: "jugador" }),
      ]);

      const titulosJugador = (titulosJugadorData ?? []) as TituloActivoTodos[];
      // Las cuentas suspendidas no aparecen en listados públicos --
      // mismo criterio que el resto de la app.
      const perfilesVisibles = (perfilesData ?? []).filter((p) => !p.suspendido);

      const otrosIdsJugador = perfilesVisibles
        .map((p) => tituloMasRelevante(p.id, titulosJugador))
        .filter((t): t is TituloResuelto => t !== null)
        .map((t) => t.otroId);

      let nombrePorUserId: Record<string, string> = {};
      if (otrosIdsJugador.length > 0) {
        const { data: otrosPerfiles } = await supabase
          .from("profiles")
          .select("id, nick, unique_id")
          .in("id", otrosIdsJugador);
        nombrePorUserId = Object.fromEntries(
          (otrosPerfiles ?? []).map((p) => [p.id, p.nick ? `${p.nick}#${p.unique_id}` : "Jugador de RemorApp"])
        );
      }

      setJugadores(
        perfilesVisibles.map((p) => {
          const t = tituloMasRelevante(p.id, titulosJugador);
          return {
            id: p.id,
            nick: p.nick ?? "Jugador de RemorApp",
            uniqueId: p.unique_id,
            liga: p.liga_1v1,
            nivel: p.nivel_1v1,
            valentia: p.valentia_jugador,
            responsabilidad: p.responsabilidad_cw,
            titulo: t ? `${t.soyPadre ? "Padre" : "Hijo"} de ${nombrePorUserId[t.otroId] ?? "?"}` : null,
          };
        })
      );

      setCargandoMuros(false);
    };

    cargarMuros();
  }, [juegoActivo]);

  useEffect(() => {
    if (juegoActivo !== "sc2") return;

    const cargarGaleria = async () => {
      setCargandoGaleria(true);
      const eventos = await construirGaleria();
      setGaleria(eventos);
      setCargandoGaleria(false);
    };

    cargarGaleria();
  }, [juegoActivo]);

  const aplicarFiltroClan = async (tagBuscado: string) => {
    setErrorFiltro(null);

    if (!tagBuscado.trim()) {
      setIdClanFiltro(null);
      setNombreClanFiltro(null);
      return;
    }

    const tag = tagBuscado.trim().toUpperCase();
    const { data } = await supabase.from("teams").select("id, tag").eq("tag", tag).maybeSingle();
    if (!data) {
      setErrorFiltro("No encontré ningún equipo con ese tag.");
      return;
    }
    setIdClanFiltro(data.id);
    setNombreClanFiltro(data.tag);
  };

  const handleFiltrarClan = async (event: FormEvent) => {
    event.preventDefault();
    await aplicarFiltroClan(filtroTag);
  };

  // Acceso directo desde /equipos/:tag ("Ver Hall of Fame"): con
  // ?clan=TAG en la URL, aplica el mismo filtro solo. El resto de
  // esta página no depende de ningún otro parámetro de la URL.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const tagDesdeUrl = searchParams.get("clan");
    if (tagDesdeUrl) {
      setFiltroTag(tagDesdeUrl.toUpperCase());
      aplicarFiltroClan(tagDesdeUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFiltrarJugador = async (event: FormEvent) => {
    event.preventDefault();
    setErrorFiltro(null);

    if (!filtroNick.trim()) {
      setIdJugadorFiltro(null);
      setNombreJugadorFiltro(null);
      return;
    }

    const partes = filtroNick.trim().split("#");
    if (partes.length !== 2 || !partes[0] || !partes[1]) {
      setErrorFiltro("Escribe el Nick#ID completo, por ejemplo CarpeDiem#12345.");
      return;
    }

    const { data } = await supabase
      .from("profiles")
      .select("id, nick, unique_id")
      .eq("nick", partes[0])
      .eq("unique_id", partes[1])
      .maybeSingle();
    if (!data) {
      setErrorFiltro("No encontré a nadie con ese Nick#ID.");
      return;
    }
    setIdJugadorFiltro(data.id);
    setNombreJugadorFiltro(`${data.nick}#${data.unique_id}`);
  };

  const galeriaFiltrada = useMemo(() => {
    return galeria.filter((evento) => {
      if (fechaDesde && new Date(evento.fecha) < new Date(fechaDesde)) return false;
      if (fechaHasta && new Date(evento.fecha) > new Date(`${fechaHasta}T23:59:59`)) return false;
      if (idClanFiltro && !evento.teamIds.includes(idClanFiltro)) return false;
      if (idJugadorFiltro && !evento.userIds.includes(idJugadorFiltro)) return false;
      return true;
    });
  }, [galeria, fechaDesde, fechaHasta, idClanFiltro, idJugadorFiltro]);

  return (
    <section className="hall-of-fame">
      <div className="hall-of-fame-header">
        <h1 className="hall-of-fame-title">Sala de la Fama</h1>
        <div className="hall-of-fame-selector">
          <label className="form-label" htmlFor="hof-juego">
            Cambiar de sala
          </label>
          <select
            id="hof-juego"
            className="form-select"
            value={juegoActivo}
            onChange={(e) => setJuegoActivo(e.target.value)}
          >
            {JUEGOS.map((j) => (
              <option key={j.id} value={j.id}>
                {j.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h2 className="hall-subtitle">Muro de Campeones</h2>
      {cargandoMuros ? (
        <p className="tournament-card-meta">Cargando el Muro de Campeones...</p>
      ) : campeones.length === 0 ? (
        <p className="detail-empty">Todavía no hay clanes registrados.</p>
      ) : (
        <div className="hall-wall">
          {campeones.map((c, i) => (
            <div key={c.id} className="hall-wall-row">
              <span className="hall-position">{i + 1}</span>
              <span className="hall-name">
                {c.nombre} <span className="profile-nick-id">[{c.tag}]</span>
              </span>
              <span className="liga-badge">{c.liga}</span>
              <span className="hall-mmr">{c.mmr} MMR</span>
              <span className="nivel-badge">Nv. {c.nivel}</span>
              {c.titulo && <span className="liga-badge">{c.titulo}</span>}
            </div>
          ))}
        </div>
      )}

      <h2 className="hall-subtitle">Muro de Jugadores</h2>
      {cargandoMuros ? (
        <p className="tournament-card-meta">Cargando el Muro de Jugadores...</p>
      ) : jugadores.length === 0 ? (
        <p className="detail-empty">Todavía no hay jugadores registrados.</p>
      ) : (
        <div className="hall-wall">
          {jugadores.map((j, i) => (
            <div key={j.id} className="hall-wall-row">
              <span className="hall-position">{i + 1}</span>
              <span className="hall-name">
                {j.nick}
                <span className="profile-nick-id">#{j.uniqueId}</span>
              </span>
              <span className="liga-badge">{j.liga}</span>
              <span className="nivel-badge">Nv. {j.nivel}</span>
              <span className="hall-mmr">Valentía {j.valentia}%</span>
              <span className="hall-mmr">Responsabilidad {j.responsabilidad}%</span>
              {j.titulo && <span className="liga-badge">{j.titulo}</span>}
            </div>
          ))}
        </div>
      )}

      <h2 className="hall-subtitle">Galería de Batallas Épicas</h2>

      <div className="hall-gallery-filters">
        <div className="form-group">
          <label className="form-label" htmlFor="hof-desde">
            Desde
          </label>
          <input
            id="hof-desde"
            className="form-input"
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="hof-hasta">
            Hasta
          </label>
          <input
            id="hof-hasta"
            className="form-input"
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
          />
        </div>

        <form className="hall-gallery-filter-form" onSubmit={handleFiltrarClan}>
          <input
            className="form-input"
            type="text"
            placeholder="Filtrar por tag de clan"
            value={filtroTag}
            onChange={(e) => setFiltroTag(e.target.value.toUpperCase())}
          />
          <button type="submit" className="btn btn-ghost">
            Filtrar
          </button>
          {nombreClanFiltro && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setIdClanFiltro(null);
                setNombreClanFiltro(null);
                setFiltroTag("");
              }}
            >
              Quitar filtro [{nombreClanFiltro}]
            </button>
          )}
        </form>

        <form className="hall-gallery-filter-form" onSubmit={handleFiltrarJugador}>
          <input
            className="form-input"
            type="text"
            placeholder="Filtrar por Nick#ID"
            value={filtroNick}
            onChange={(e) => setFiltroNick(e.target.value)}
          />
          <button type="submit" className="btn btn-ghost">
            Filtrar
          </button>
          {nombreJugadorFiltro && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setIdJugadorFiltro(null);
                setNombreJugadorFiltro(null);
                setFiltroNick("");
              }}
            >
              Quitar filtro [{nombreJugadorFiltro}]
            </button>
          )}
        </form>
      </div>

      {errorFiltro && <div className="form-error">{errorFiltro}</div>}

      {cargandoGaleria ? (
        <p className="tournament-card-meta">Cargando la Galería...</p>
      ) : galeriaFiltrada.length === 0 ? (
        <p className="detail-empty">No hay batallas épicas para mostrar con estos filtros.</p>
      ) : (
        <div className="hall-gallery">
          {galeriaFiltrada.map((evento) => (
            <div key={evento.id} className="hall-gallery-item">
              <span className="hall-gallery-fecha">{formatFecha(evento.fecha)}</span>
              <p className="hall-gallery-texto">{evento.texto}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
