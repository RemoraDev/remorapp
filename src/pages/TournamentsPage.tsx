import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import TournamentListCard from "../components/TournamentListCard";
import type { TournamentRow } from "../types/tournaments";

export default function TournamentsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [torneos, setTorneos] = useState<TournamentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creandoRaceWar, setCreandoRaceWar] = useState(false);

  // Migración 106: Race War es un evento independiente, no un
  // complemento de un torneo -- un solo click alcanza (crear_race_war()
  // arma por dentro un torneo oculto como anfitrión técnico, invisible
  // en este listado porque queda con publico = false) y entra directo
  // a la página del marcador.
  const handleCrearRaceWar = async () => {
    if (!user) {
      navigate("/login");
      return;
    }
    setCreandoRaceWar(true);
    const { data, error } = await supabase.rpc("crear_race_war");
    setCreandoRaceWar(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate(`/guerra-razas/${data}`);
  };

  useEffect(() => {
    // Solo torneos públicos y abiertos. Los privados existen en la
    // base pero nunca se listan acá: solo son visibles por link
    // directo a /tournaments/:id (ver política RLS en el schema).
    supabase
      .from("tournaments")
      .select("*")
      .eq("publico", true)
      .eq("estado", "abierto")
      // Migración 069: el organizador puede excluir su torneo del
      // buscador público -- sigue existiendo y siendo accesible por
      // link directo (RLS ya lo permite), solo no aparece listado acá.
      .eq("excluido_de_busqueda", false)
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
        <div className="tournaments-head-actions">
          <button type="button" className="btn btn-ghost" onClick={handleCrearRaceWar} disabled={creandoRaceWar}>
            {creandoRaceWar ? "Creando..." : "Crear Race War"}
          </button>
          <Link to="/tournaments/create" className="btn btn-primary">
            Crear torneo
          </Link>
        </div>
      </div>

      <p className="tournament-card-meta">
        <Link to="/tournaments/history" className="btn-link">
          Ver historial de torneos finalizados
        </Link>
        {" · "}
        <Link to="/torneos-historicos" className="btn-link">
          Ver torneos históricos (pre-RemorApp)
        </Link>
      </p>

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
