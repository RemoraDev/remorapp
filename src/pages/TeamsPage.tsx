import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import type { EquipoDelUsuario } from "../lib/teams";
import { SC2_REGION_OPTIONS } from "../types/profile";
import type { Sc2Region } from "../types/profile";
import type { TeamRow } from "../types/teams";

interface TeamConInfo extends TeamRow {
  ownerNick: string | null;
  ownerUniqueId: string | null;
  memberCount: number;
}

export default function TeamsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [equipos, setEquipos] = useState<TeamConInfo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [regionFiltro, setRegionFiltro] = useState<Sc2Region | "">("");

  const [codigo, setCodigo] = useState("");
  const [uniendose, setUniendose] = useState(false);
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);

  const [equipoActual, setEquipoActual] = useState<EquipoDelUsuario | null>(null);

  useEffect(() => {
    if (user) obtenerEquipoDelUsuario(user.id).then(setEquipoActual);
  }, [user]);

  useEffect(() => {
    const cargarEquipos = async () => {
      setCargando(true);

      let query = supabase.from("teams").select("*, profiles!owner_id(nick, unique_id)").eq(
        "is_public",
        true
      );
      if (regionFiltro) query = query.overlaps("sc2_regions", [regionFiltro]);

      const { data: equiposData, error } = await query.order("created_at", { ascending: false });

      if (error || !equiposData) {
        console.error("Error cargando equipos:", error);
        setCargando(false);
        return;
      }

      const teamIds = equiposData.map((t) => t.id as string);
      let conteoPorEquipo: Record<string, number> = {};

      if (teamIds.length > 0) {
        const { data: miembrosData } = await supabase
          .from("team_members")
          .select("team_id")
          .in("team_id", teamIds);

        conteoPorEquipo = (miembrosData ?? []).reduce<Record<string, number>>((acc, m) => {
          acc[m.team_id] = (acc[m.team_id] ?? 0) + 1;
          return acc;
        }, {});
      }

      setEquipos(
        equiposData.map((t) => {
          // profiles!owner_id puede venir como objeto o array de 1 según
          // la versión, sin tipos generados no hay forma de saberlo en
          // tiempo de compilación (mismo caso que ya vimos con los
          // mapas de un torneo).
          const propietario = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles;
          return {
            ...(t as TeamRow),
            ownerNick: propietario?.nick ?? null,
            ownerUniqueId: propietario?.unique_id ?? null,
            memberCount: conteoPorEquipo[t.id as string] ?? 0,
          };
        })
      );
      setCargando(false);
    };

    cargarEquipos();
  }, [regionFiltro]);

  const equiposFiltrados = equipos.filter((t) => {
    if (!busqueda.trim()) return true;
    const termino = busqueda.trim().toLowerCase();
    const nickTag = t.ownerNick ? `${t.ownerNick}#${t.ownerUniqueId}`.toLowerCase() : "";
    return (
      t.name.toLowerCase().includes(termino) ||
      t.tag.toLowerCase().includes(termino) ||
      nickTag.includes(termino)
    );
  });

  const handleUnirse = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    if (equipoActual) {
      setErrorCodigo("Ya perteneces a un equipo.");
      return;
    }

    setUniendose(true);
    setErrorCodigo(null);

    const codigoNormalizado = codigo.trim().toUpperCase();
    const { data: equipo } = await supabase
      .from("teams")
      .select("id, tag")
      .eq("invite_code", codigoNormalizado)
      .maybeSingle();

    if (!equipo) {
      setErrorCodigo("Código no encontrado wn.");
      setUniendose(false);
      return;
    }

    const { error: joinError } = await supabase
      .from("team_members")
      .insert({ user_id: user.id, team_id: equipo.id, roles: ["jugador"] });

    setUniendose(false);

    if (joinError) {
      setErrorCodigo(
        joinError.code === "23505" ? "Ya perteneces a un equipo." : joinError.message
      );
      return;
    }

    navigate(`/equipos/${equipo.tag}`);
  };

  return (
    <section className="section section-page">
      <div className="section-head">
        <h1 className="section-title">Equipos</h1>
        <Link to="/equipos/crear" className="btn btn-primary">
          Crear equipo
        </Link>
      </div>

      <form className="team-join-box" onSubmit={handleUnirse}>
        <div className="form-group">
          <label className="form-label" htmlFor="team-codigo">
            ¿Tienes un código de invitación?
          </label>
          <div className="team-join-row">
            <input
              id="team-codigo"
              className="form-input"
              type="text"
              maxLength={6}
              placeholder="Código de 6 caracteres"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            />
            <button type="submit" className="btn btn-ghost" disabled={uniendose || !user}>
              {uniendose ? "Uniendo..." : "Unirme"}
            </button>
          </div>
        </div>
        {!user && <p className="tournament-card-meta">Inicia sesión para unirte con un código.</p>}
        {errorCodigo && <div className="form-error">{errorCodigo}</div>}
      </form>

      <div className="team-search-bar">
        <input
          className="form-input"
          type="text"
          placeholder="Buscar por nombre, tag o Nick#ID del dueño"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select
          className="form-select"
          value={regionFiltro}
          onChange={(e) => setRegionFiltro(e.target.value as Sc2Region | "")}
        >
          <option value="">Todos los servidores</option>
          {SC2_REGION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {cargando && <p className="tournament-card-meta">Cargando equipos...</p>}
      {!cargando && equiposFiltrados.length === 0 && (
        <p className="tournament-card-meta">No hay equipos que calcen con esa búsqueda.</p>
      )}

      <div className="team-grid">
        {equiposFiltrados.map((equipo) => (
          <Link key={equipo.id} to={`/equipos/${equipo.tag}`} className="team-card">
            {equipo.logo_url ? (
              <img src={equipo.logo_url} alt={equipo.name} className="team-card-logo" />
            ) : (
              <div className="team-card-logo team-card-logo-placeholder">{equipo.tag.charAt(0)}</div>
            )}
            <div className="team-card-info">
              <p className="team-card-name">{equipo.name}</p>
              <p className="team-card-tag">[{equipo.tag}]</p>
              <div className="team-card-regions">
                {equipo.sc2_regions.map((region) => (
                  <span key={region} className="badge badge-format">
                    {SC2_REGION_OPTIONS.find((o) => o.value === region)?.label ?? region}
                  </span>
                ))}
              </div>
              <p className="team-card-meta">
                {equipo.memberCount} {equipo.memberCount === 1 ? "miembro" : "miembros"}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
