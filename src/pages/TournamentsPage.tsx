import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import TournamentListCard from "../components/TournamentListCard";
import CommissionInfo from "../components/CommissionInfo";
import type { TournamentRow } from "../types/tournaments";

export default function TournamentsPage() {
  const [torneos, setTorneos] = useState<TournamentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Solo torneos públicos y abiertos. Los privados existen en la
    // base pero nunca se listan acá: solo son visibles por link
    // directo a /tournaments/:id (ver política RLS en el schema).
    supabase
      .from("tournaments")
      .select("*")
      .eq("publico", true)
      .eq("estado", "abierto")
      .order("fecha_inicio", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error("Error cargando torneos:", error);
        } else {
          setTorneos(data ?? []);
        }
        setLoading(false);
      });
  }, []);

  return (
    <section className="section section-page">
      <div className="section-head">
        <h1 className="section-title">Torneos</h1>
        <Link to="/tournaments/create" className="btn btn-primary">
          Crear torneo
        </Link>
      </div>

      <p className="tournament-card-meta">
        <Link to="/tournaments/history" className="btn-link">
          Ver historial de torneos finalizados
        </Link>
      </p>

      {/* Se movió acá desde Inicio, tal cual estaba -- quien busca
          torneos ve esta info antes de empezar a explorar la grilla. */}
      <CommissionInfo />

      {loading && <p className="tournament-card-meta">Cargando torneos...</p>}

      {!loading && torneos.length === 0 && (
        <p className="tournament-card-meta">No hay torneos abiertos por ahora.</p>
      )}

      {!loading && torneos.length > 0 && (
        <div className="tournament-grid">
          {torneos.map((torneo) => (
            <TournamentListCard key={torneo.id} torneo={torneo} />
          ))}
        </div>
      )}
    </section>
  );
}
