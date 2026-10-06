import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Swords, Trophy } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { obtenerEquipoDelUsuario } from "../lib/teams";
import type { EquipoDelUsuario } from "../lib/teams";
import type {
  DivisionLiga,
  Liga,
  MiniEvento,
  RankingActividadClan,
  RankingClan,
  RankingJugador,
  RankingMinievento,
} from "../types/ranking";

// null = "General" (suma las tres ligas, sin distinguir división) --
// no es una fila de la tabla ligas, es un valor especial de la UI.
type CategoriaLiga = Liga | null;

// Migración 164: "Ranking privado" deja de ser una sección fija
// debajo de "Race War" -- pasa a ser una tercera opción del mismo
// grupo de pills, a pedido del usuario.
type SubTipoMinievento = MiniEvento["tipo"] | "ranking";

// Migración 164: "Ranking" pasa de dos bloques apilados (clanes y
// jugadores) a tres sub-pestañas, sumando "Clanes más activos".
type SubtabRanking = "clanes" | "jugadores" | "actividad";

export default function RankingPage() {
  const { user } = useAuth();
  // Migración 148: "Mini eventos" -- pestaña privada, solo visible
  // para quien pertenece a un clan (oculta al público, a propósito).
  const [seccion, setSeccion] = useState<"ranking" | "minieventos">("ranking");
  const [subtabRanking, setSubtabRanking] = useState<SubtabRanking>("clanes");
  // Migración 150: Race War y Clan War Amistosa ya no van mezcladas en
  // una sola lista -- sub-pestañas separadas dentro de "Mini eventos".
  const [subTipoMinievento, setSubTipoMinievento] = useState<SubTipoMinievento>("race_war");
  const [miEquipo, setMiEquipo] = useState<EquipoDelUsuario | null>(null);
  const [minieventos, setMinieventos] = useState<MiniEvento[]>([]);
  const [rankingMinieventos, setRankingMinieventos] = useState<RankingMinievento[]>([]);
  const [cargandoMinieventos, setCargandoMinieventos] = useState(false);
  const [rankingActividad, setRankingActividad] = useState<RankingActividadClan[]>([]);
  const [cargandoActividad, setCargandoActividad] = useState(true);

  useEffect(() => {
    if (user) obtenerEquipoDelUsuario(user.id).then(setMiEquipo);
  }, [user]);

  useEffect(() => {
    if (seccion !== "minieventos" || !miEquipo) return;
    setCargandoMinieventos(true);
    Promise.all([supabase.rpc("mis_minieventos_clan"), supabase.rpc("ranking_minieventos_clan")]).then(
      ([eventosRes, rankingRes]) => {
        if (eventosRes.error) console.error("Error cargando mis minieventos:", eventosRes.error);
        if (rankingRes.error) console.error("Error cargando el ranking de minieventos:", rankingRes.error);
        setMinieventos((eventosRes.data ?? []) as MiniEvento[]);
        setRankingMinieventos((rankingRes.data ?? []) as RankingMinievento[]);
        setCargandoMinieventos(false);
      }
    );
  }, [seccion, miEquipo]);

  const [ligas, setLigas] = useState<Liga[]>([]);
  const [divisiones, setDivisiones] = useState<DivisionLiga[]>([]);
  const [categoria, setCategoria] = useState<CategoriaLiga>(null);
  const [divisionId, setDivisionId] = useState<string | null>(null);
  const [ranking, setRanking] = useState<RankingClan[]>([]);
  const [cargando, setCargando] = useState(true);

  // Ranking de jugadores (migración 063): independiente de liga,
  // división o evento -- se carga una sola vez, no depende de
  // categoria/divisionId.
  const [rankingJugadores, setRankingJugadores] = useState<RankingJugador[]>([]);
  const [cargandoJugadores, setCargandoJugadores] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from("ligas").select("id, nombre").order("nombre"),
      supabase.from("divisiones_liga").select("id, liga_id, nombre, mmr_limite").order("nombre"),
    ]).then(([ligasRes, divisionesRes]) => {
      setLigas(ligasRes.data ?? []);
      setDivisiones(divisionesRes.data ?? []);
    });
  }, []);

  const divisionesDeLaLiga = divisiones.filter((d) => d.liga_id === categoria?.id);

  // Al entrar a una liga específica (no "General"), se para directo en
  // su primera división -- "General" es la única categoría sin
  // división, así que no tiene sentido dejarla "sin elegir" cuando sí
  // hay una liga puntual seleccionada.
  const handleElegirLiga = (liga: CategoriaLiga) => {
    setCategoria(liga);
    if (!liga) {
      setDivisionId(null);
      return;
    }
    const primera = divisiones.find((d) => d.liga_id === liga.id);
    setDivisionId(primera?.id ?? null);
  };

  useEffect(() => {
    setCargando(true);
    supabase
      .rpc("ranking_clanes", { p_liga_id: categoria?.id ?? null, p_division_id: categoria ? divisionId : null })
      .then(({ data, error }) => {
        if (error) {
          console.error("Error cargando el ranking:", error);
          setRanking([]);
        } else {
          setRanking((data ?? []) as RankingClan[]);
        }
        setCargando(false);
      });
  }, [categoria, divisionId]);

  useEffect(() => {
    supabase.rpc("ranking_jugadores").then(({ data, error }) => {
      if (error) {
        console.error("Error cargando el ranking de jugadores:", error);
        setRankingJugadores([]);
      } else {
        setRankingJugadores((data ?? []) as RankingJugador[]);
      }
      setCargandoJugadores(false);
    });
  }, []);

  useEffect(() => {
    supabase.rpc("ranking_actividad_clanes").then(({ data, error }) => {
      if (error) {
        console.error("Error cargando el ranking de actividad:", error);
        setRankingActividad([]);
      } else {
        setRankingActividad((data ?? []) as RankingActividadClan[]);
      }
      setCargandoActividad(false);
    });
  }, []);

  return (
    <section className="section section-page">
      <h1 className="section-title">Ranking</h1>

      {/* Solo aparece si pertenezco a un clan -- oculta al público a
          propósito, los mini eventos de un clan son privados: ni
          siquiera otro clan los ve. */}
      {miEquipo && (
        <div className="team-info-tabs ranking-tabs">
          <button
            type="button"
            className={`team-info-tab ${seccion === "ranking" ? "is-active" : ""}`}
            onClick={() => setSeccion("ranking")}
          >
            <Trophy className="icon-inline" />
            Ranking
          </button>
          <button
            type="button"
            className={`team-info-tab ${seccion === "minieventos" ? "is-active" : ""}`}
            onClick={() => setSeccion("minieventos")}
          >
            <Swords className="icon-inline" />
            Mini eventos
          </button>
        </div>
      )}

      {seccion === "minieventos" && miEquipo ? (
        <>
          <div className="pill-radio-group">
            <label className={`pill-radio-option ${subTipoMinievento === "race_war" ? "selected" : ""}`}>
              <input
                type="radio"
                className="sr-only"
                name="sub-tipo-minievento"
                checked={subTipoMinievento === "race_war"}
                onChange={() => setSubTipoMinievento("race_war")}
              />
              Race War
            </label>
            <label className={`pill-radio-option ${subTipoMinievento === "clan_war_amistosa" ? "selected" : ""}`}>
              <input
                type="radio"
                className="sr-only"
                name="sub-tipo-minievento"
                checked={subTipoMinievento === "clan_war_amistosa"}
                onChange={() => setSubTipoMinievento("clan_war_amistosa")}
              />
              Clan War Amistosa
            </label>
            <label className={`pill-radio-option ${subTipoMinievento === "ranking" ? "selected" : ""}`}>
              <input
                type="radio"
                className="sr-only"
                name="sub-tipo-minievento"
                checked={subTipoMinievento === "ranking"}
                onChange={() => setSubTipoMinievento("ranking")}
              />
              Ranking {miEquipo.teamTag}
            </label>
          </div>

          {(subTipoMinievento === "race_war" || subTipoMinievento === "clan_war_amistosa") &&
            (() => {
              const filtrados = minieventos.filter((ev) => ev.tipo === subTipoMinievento);
              if (cargandoMinieventos) return <p className="tournament-card-meta">Cargando...</p>;
              if (filtrados.length === 0) {
                return (
                  <p className="detail-empty">
                    {subTipoMinievento === "race_war"
                      ? "Todavía no creaste ninguna Race War."
                      : "Todavía no jugaste ninguna Clan War Amistosa."}
                  </p>
                );
              }
              return (
                <div className="table-scroll">
                  <table className="group-standings-table ranking-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Fecha</th>
                        <th>Rival</th>
                        <th>Resultado</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtrados.map((ev) => (
                        <tr key={ev.id}>
                          <td>{ev.titulo}</td>
                          <td>{new Date(ev.fecha).toLocaleDateString("es")}</td>
                          <td>{ev.rival_nombre ?? "--"}</td>
                          <td>{ev.resultado ?? "--"}</td>
                          <td>
                            <Link
                              to={ev.tipo === "race_war" ? `/guerra-razas/${ev.id}` : `/clan-war/${ev.id}`}
                              className="btn btn-ghost"
                            >
                              Ver
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

          {subTipoMinievento === "ranking" && (
            <>
              <h2 className="section-title ranking-jugadores-titulo">Ranking {miEquipo.teamTag}</h2>
              <p className="tournament-card-meta">
                Puntos acumulados de tus jugadores a través de todas las Race War de tu clan.
              </p>
              {cargandoMinieventos ? (
                <p className="tournament-card-meta">Cargando...</p>
              ) : rankingMinieventos.length === 0 ? (
                <p className="detail-empty">Todavía no hay puntos registrados en ninguna Race War de tu clan.</p>
              ) : (
                <div className="table-scroll">
                  <table className="group-standings-table ranking-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Jugador</th>
                        <th>Puntos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankingMinieventos.map((fila, indice) => (
                        <tr key={fila.jugador_nombre}>
                          <td>{indice + 1}</td>
                          <td>{fila.jugador_nombre}</td>
                          <td>{fila.puntos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="team-info-subtabs ranking-subtabs">
            <button
              type="button"
              className={`team-info-subtab ${subtabRanking === "clanes" ? "is-active" : ""}`}
              onClick={() => setSubtabRanking("clanes")}
            >
              Ranking de clanes
            </button>
            <button
              type="button"
              className={`team-info-subtab ${subtabRanking === "jugadores" ? "is-active" : ""}`}
              onClick={() => setSubtabRanking("jugadores")}
            >
              Ranking de jugadores
            </button>
            <button
              type="button"
              className={`team-info-subtab ${subtabRanking === "actividad" ? "is-active" : ""}`}
              onClick={() => setSubtabRanking("actividad")}
            >
              Clanes más activos
            </button>
          </div>

          {subtabRanking === "clanes" && (
            <>
              <div className="pill-radio-group ranking-categorias">
                {ligas.map((liga) => (
                  <label key={liga.id} className={`pill-radio-option ${categoria?.id === liga.id ? "selected" : ""}`}>
                    <input
                      type="radio"
                      className="sr-only"
                      name="categoria-ranking"
                      checked={categoria?.id === liga.id}
                      onChange={() => handleElegirLiga(liga)}
                    />
                    {liga.nombre}
                  </label>
                ))}
              </div>

              {categoria && divisionesDeLaLiga.length > 0 && (
                <div className="pill-radio-group ranking-divisiones">
                  {divisionesDeLaLiga.map((division) => (
                    <label key={division.id} className={`pill-radio-option ${divisionId === division.id ? "selected" : ""}`}>
                      <input
                        type="radio"
                        className="sr-only"
                        name="division-ranking"
                        checked={divisionId === division.id}
                        onChange={() => setDivisionId(division.id)}
                      />
                      {division.nombre}
                    </label>
                  ))}
                </div>
              )}

              {cargando ? (
                <p className="tournament-card-meta">Cargando ranking...</p>
              ) : ranking.length === 0 ? (
                <p className="detail-empty">
                  Todavía no hay ningún torneo finalizado en esta categoría con un clan campeón.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="group-standings-table ranking-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Clan</th>
                        <th>Torneos ganados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((fila, indice) => (
                        <tr key={fila.team_id}>
                          <td>{indice + 1}</td>
                          <td>
                            <Link to={`/equipos/${fila.team_tag}`} className="ranking-clan-link">
                              {fila.logo_url ? (
                                <img src={fila.logo_url} alt="" className="ranking-clan-logo" />
                              ) : (
                                <span className="ranking-clan-logo ranking-clan-logo-placeholder">
                                  {fila.team_tag.charAt(0)}
                                </span>
                              )}
                              {fila.team_name} [{fila.team_tag}]
                            </Link>
                          </td>
                          <td>{fila.torneos_ganados}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Ranking de jugadores (migración 063): independiente de liga,
              división o evento -- suma victorias de torneos 1v1, Clan War
              simple y sets WTL en un solo número por jugador. */}
          {subtabRanking === "jugadores" && (
            cargandoJugadores ? (
              <p className="tournament-card-meta">Cargando ranking de jugadores...</p>
            ) : rankingJugadores.length === 0 ? (
              <p className="detail-empty">Todavía nadie tiene ninguna partida ganada registrada.</p>
            ) : (
              <div className="table-scroll">
                <table className="group-standings-table ranking-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Jugador</th>
                      <th>Liga</th>
                      <th>Raza</th>
                      <th>Equipo</th>
                      <th>Victorias</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingJugadores.map((fila, indice) => (
                      <tr key={fila.jugador_id}>
                        <td>{indice + 1}</td>
                        <td>
                          {fila.nick ?? "Jugador de RemorApp"}
                          {fila.nick && <span className="profile-nick-id">#{fila.unique_id}</span>}
                        </td>
                        <td>{fila.liga ?? "--"}</td>
                        <td>{fila.raza_principal ?? "--"}</td>
                        <td>
                          {fila.team_id ? (
                            <span className="ranking-clan-link">
                              {fila.team_logo_url ? (
                                <img src={fila.team_logo_url} alt="" className="player-detail-equipo-actual-logo" />
                              ) : (
                                <span className="player-detail-equipo-actual-logo player-detail-equipo-actual-logo-placeholder">
                                  {fila.team_tag?.charAt(0)}
                                </span>
                              )}
                              {fila.team_tag}
                            </span>
                          ) : (
                            "NO"
                          )}
                        </td>
                        <td>{fila.victorias}</td>
                        <td>
                          {fila.nick ? (
                            <Link to={`/jugador/${fila.nick}/${fila.unique_id}`} className="btn btn-ghost">
                              Inspeccionar
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* Clanes más activos (migración 164): Clan Wars + torneos +
              Race War organizadas, sumados en un solo número por
              clan -- a pedido del usuario, junto a los otros dos
              rankings. */}
          {subtabRanking === "actividad" && (
            cargandoActividad ? (
              <p className="tournament-card-meta">Cargando ranking de actividad...</p>
            ) : rankingActividad.length === 0 ? (
              <p className="detail-empty">Todavía ningún clan tiene actividad registrada.</p>
            ) : (
              <div className="table-scroll">
                <table className="group-standings-table ranking-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Clan</th>
                      <th>Actividades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingActividad.map((fila, indice) => (
                      <tr key={fila.team_id}>
                        <td>{indice + 1}</td>
                        <td>
                          <Link to={`/equipos/${fila.team_tag}`} className="ranking-clan-link">
                            {fila.logo_url ? (
                              <img src={fila.logo_url} alt="" className="ranking-clan-logo" />
                            ) : (
                              <span className="ranking-clan-logo ranking-clan-logo-placeholder">
                                {fila.team_tag.charAt(0)}
                              </span>
                            )}
                            {fila.team_name} [{fila.team_tag}]
                          </Link>
                        </td>
                        <td>{fila.actividades}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}
    </section>
  );
}
