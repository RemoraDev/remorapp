import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";

interface Guia {
  titulo: string;
  texto: string;
}

// Guías cortas de ejemplo -- reemplaza a la vista de ejemplo que tenía
// /foro. Contenido estático por ahora, igual que el resto de las
// vistas "de ejemplo" del proyecto (Noticias, el Foro que reemplaza).
const GUIAS: Guia[] = [
  {
    titulo: "Cómo crear un torneo",
    texto:
      "Desde \"Torneos\" en la barra inferior, tocá \"Crear torneo\". Elegí formato, modo, mapas y fecha. Una vez creado, los jugadores pueden inscribirse hasta que abras el check-in y generes la llave.",
  },
  {
    titulo: "Cómo crear un equipo",
    texto:
      "Desde \"Equipos\", tocá \"Crear equipo\". Elegí nombre, tag (3 a 6 letras) y el o los servidores donde juega tu clan. Vas a quedar como dueño, con un código de invitación para sumar jugadores.",
  },
  {
    titulo: "Cómo funciona el MMR",
    texto:
      "Cada jugador y cada equipo tienen su propio MMR, que sube o baja según resultados reales (torneos y Clan Wars). El MMR define tu liga automáticamente, de Bronce 3 hasta Gran Maestro -- no se edita a mano.",
  },
  {
    titulo: "Cómo funciona un Clan War",
    texto:
      "El líder de un equipo propone un reto a otro equipo, con fecha y hora. Si el rival acepta, 15 minutos antes se abre el check-in para confirmar alineación. Se juegan las partidas y, al cerrar la guerra, se ajusta el MMR de ambos clanes según el resultado.",
  },
  {
    titulo: "Cómo funcionan los Títulos Padre/Hijo",
    texto:
      "Un equipo o jugador puede retar a otro a un título por una duración fija. Si el rival acepta, el título se resuelve solo con el resultado de la próxima Clan War o partida 1v1 real entre ambos -- no hace falta reportarlo aparte.",
  },
];

interface Pregunta {
  pregunta: string;
  respuesta: string;
}

const PREGUNTAS_FRECUENTES: Pregunta[] = [
  {
    pregunta: "¿Por qué mi equipo aparece en \"Banca Rota\"?",
    respuesta:
      "Pasa cuando el MMR cae a 500 o menos. Un equipo o jugador en banca rota no puede seguir bajando de liga, y se restaura solo a 1000 MMR si pasan 30 días sin actividad.",
  },
  {
    pregunta: "¿Puedo estar en más de un equipo a la vez?",
    respuesta: "No. Cada cuenta puede pertenecer a un solo equipo. Para cambiarte, primero tenés que salir del actual.",
  },
  {
    pregunta: "¿Qué pasa si abandono un torneo ya inscrito?",
    respuesta:
      "Tu inscripción se borra. Si sos el organizador y el torneo queda sin nadie más inscrito, el torneo se elimina por completo.",
  },
  {
    pregunta: "¿Cómo cambio la forma de mi avatar (cuadrado o redondo)?",
    respuesta: "Desde el menú de tu avatar (arriba a la derecha) → Configuración.",
  },
];

export default function AyudaPage() {
  const { user } = useAuth();
  const [tieneEquipo, setTieneEquipo] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(null);

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    if (!user) {
      setTieneEquipo(false);
      setTeamId(null);
      return;
    }

    supabase
      .from("team_members")
      .select("team_id, roles")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const esDueño = !!data && (data.roles as string[]).includes("owner");
        setTieneEquipo(esDueño);
        setTeamId(esDueño ? data.team_id : null);
      });
  }, [user]);

  const handleEnviarSugerencia = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !teamId) return;

    if (!texto.trim()) {
      setError("Escribe tu sugerencia antes de enviarla.");
      return;
    }

    setEnviando(true);
    setError(null);
    setEnviado(false);

    const { error: insertError } = await supabase
      .from("sugerencias_lider")
      .insert({ team_id: teamId, autor_id: user.id, texto: texto.trim() });

    setEnviando(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setTexto("");
    setEnviado(true);
  };

  return (
    <section className="section section-page">
      <h1 className="section-title">Ayuda</h1>

      <h2 className="detail-subtitle">Guías</h2>
      <div className="history-list">
        {GUIAS.map((g) => (
          <div key={g.titulo} className="history-card">
            <h3 className="tournament-card-title">{g.titulo}</h3>
            <p className="tournament-card-meta">{g.texto}</p>
          </div>
        ))}
      </div>

      <h2 className="detail-subtitle">Preguntas frecuentes</h2>
      <div className="history-list">
        {PREGUNTAS_FRECUENTES.map((p) => (
          <details key={p.pregunta} className="history-card">
            <summary className="tournament-card-title">{p.pregunta}</summary>
            <p className="tournament-card-meta">{p.respuesta}</p>
          </details>
        ))}
      </div>

      <h2 className="detail-subtitle">Sugerir una mejora</h2>
      {!user && <p className="tournament-card-meta">Inicia sesión para sugerir una mejora.</p>}
      {user && !tieneEquipo && (
        <p className="tournament-card-meta">
          Por ahora, sugerir mejoras es solo para líderes de clan.
        </p>
      )}
      {user && tieneEquipo && (
        <form className="auth-form" onSubmit={handleEnviarSugerencia}>
          {error && <div className="form-error">{error}</div>}
          {enviado && <div className="form-success">¡Gracias por tu sugerencia!</div>}
          <div className="form-group">
            <label className="form-label" htmlFor="ayuda-sugerencia">
              Tu sugerencia
            </label>
            <textarea
              id="ayuda-sugerencia"
              className="form-textarea"
              maxLength={1000}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={enviando}>
            {enviando ? "Enviando..." : "Enviar sugerencia"}
          </button>
        </form>
      )}
    </section>
  );
}
