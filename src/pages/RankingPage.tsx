import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import type { DivisionLiga, Liga, RankingClan } from "../types/ranking";

// null = "General" (suma las tres ligas, sin distinguir división) --
// no es una fila de la tabla ligas, es un valor especial de la UI.
type CategoriaLiga = Liga | null;

export default function RankingPage() {
  const [ligas, setLigas] = useState<Liga[]>([]);
  const [divisiones, setDivisiones] = useState<DivisionLiga[]>([]);
  const [categoria, setCategoria] = useState<CategoriaLiga>(null);
  const [divisionId, setDivisionId] = useState<string | null>(null);
  const [ranking, setRanking] = useState<RankingClan[]>([]);
  const [cargando, setCargando] = useState(true);

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

  return (
    <section className="section section-page">
      <h1 className="section-title">Ranking de clanes</h1>
      <p className="tournament-card-meta">
        Ordenado por cantidad de torneos ganados en cada liga y división. "General" suma las tres
        ligas, sin distinguir división.
      </p>

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
        <label className={`pill-radio-option ${categoria === null ? "selected" : ""}`}>
          <input
            type="radio"
            className="sr-only"
            name="categoria-ranking"
            checked={categoria === null}
            onChange={() => handleElegirLiga(null)}
          />
          General
        </label>
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
      )}
    </section>
  );
}
