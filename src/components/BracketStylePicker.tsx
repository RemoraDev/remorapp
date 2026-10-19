import { useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  FONDO_BRACKET_OPTIONS,
  ESTILO_LINEA_BRACKET_OPTIONS,
  ESTRUCTURA_BRACKET_OPTIONS,
  PALETA_COLOR_LINEA_BRACKET,
  PALETA_COLOR_TEXTO_BRACKET,
  ESTILO_TITULO_BRACKET_OPTIONS,
  INSIGNIA_BRACKET_OPTIONS,
} from "../types/tournaments";
import type {
  FondoBracket,
  EstiloLineaBracket,
  EstructuraBracket,
  EstiloTituloBracket,
  InsigniaBracket,
} from "../types/tournaments";

interface BracketStylePickerProps {
  tournamentId: string;
  fondo: FondoBracket;
  estiloLinea: EstiloLineaBracket;
  estructura: EstructuraBracket;
  colorLinea: string | null;
  estiloTitulo: EstiloTituloBracket;
  colorTexto: string | null;
  colorTextoTitulo: string | null;
  insignia: InsigniaBracket;
  onCambio: () => void;
}

// Mini-diagrama abstracto de cada estructura (migración 177) -- mismo
// espíritu que PreviewDiagrama de EstructuraLineupPicker.tsx, 4
// variantes bien distintas entre sí para que se entienda de un
// vistazo sin tener que leer la descripción.
function PreviewEstructura({ variante }: { variante: EstructuraBracket }) {
  if (variante === "vertical") {
    return (
      <div className="estructura-bracket-preview estructura-bracket-preview-vertical">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (variante === "embudo") {
    return (
      <div className="estructura-bracket-preview estructura-bracket-preview-embudo">
        <span />
        <span className="estructura-bracket-preview-centro" />
        <span />
      </div>
    );
  }
  if (variante === "compacta") {
    return (
      <div className="estructura-bracket-preview estructura-bracket-preview-compacta">
        <span />
        <span />
        <span />
        <span />
      </div>
    );
  }
  return (
    <div className="estructura-bracket-preview estructura-bracket-preview-clasico">
      <span />
      <span />
      <span />
    </div>
  );
}

// Mini-render del efecto de línea elegido (migración 176): a
// diferencia de la llave real, acá no hay nada que medir en el DOM --
// un trazo en escuadra fijo alcanza para mostrar el efecto, con el
// mismo CSS real (.bracket-conectores, ver halcon.css). Migración 179:
// también respeta el color personalizado elegido (--linea-color), así
// la vista previa no miente sobre cómo se va a ver.
function MiniLinea({ estiloLinea, colorLinea }: { estiloLinea: EstiloLineaBracket; colorLinea: string | null }) {
  return (
    <div className="bracket-linea-preview">
      <svg
        className="bracket-conectores"
        data-estilo-linea={estiloLinea}
        viewBox="0 0 90 60"
        style={colorLinea ? ({ "--linea-color": colorLinea } as CSSProperties) : undefined}
      >
        <path d="M 5 15 H 45 V 45 H 85" />
      </svg>
    </div>
  );
}

// Mini-render real de un "modelo" de franja de título (migración 181)
// -- mismo patrón que .bracket-style-preview: el CSS real
// (.bracket-esports-banner[data-estilo-titulo]) aplicado a una caja
// chica, no una captura.
function PreviewTitulo({ estiloTitulo }: { estiloTitulo: EstiloTituloBracket }) {
  return (
    <div className="bracket-titulo-preview">
      <div className="bracket-esports-banner" data-estilo-titulo={estiloTitulo}>
        Título
      </div>
    </div>
  );
}

// Selector de estructura + fondo + efecto de línea, solo para el
// organizador. Cada opción se aplica al instante al elegirla (mismo
// patrón que la selección de tema de equipo en TeamDetailPage.tsx) --
// el mini-render de cada tarjeta ES la vista previa, no hace falta un
// paso de "confirmar" aparte.
//
// Migración 178, a pedido del usuario: "Estilo de bracket" (Clásico/
// Esports/StarCraft Oficial) sale del todo -- Esports queda como único
// estilo (ya se setea por default en la base, ver migración 178), sin
// selector visible acá.
export default function BracketStylePicker({
  tournamentId,
  fondo,
  estiloLinea,
  estructura,
  colorLinea,
  estiloTitulo,
  colorTexto,
  colorTextoTitulo,
  insignia,
  onCambio,
}: BracketStylePickerProps) {
  // Antes, si el update fallaba (por ejemplo porque el constraint de
  // la base todavía no tenía los valores nuevos), no pasaba nada
  // visible -- parecía que el botón "no hacía nada". Ahora se avisa.
  const [error, setError] = useState<string | null>(null);

  const handleCambiarFondo = async (nuevoFondo: FondoBracket) => {
    if (nuevoFondo === fondo) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ fondo_bracket: nuevoFondo })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  const handleCambiarLinea = async (nuevaLinea: EstiloLineaBracket) => {
    if (nuevaLinea === estiloLinea) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ estilo_linea_bracket: nuevaLinea })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  const handleCambiarEstructura = async (nueva: EstructuraBracket) => {
    if (nueva === estructura) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ estructura_bracket: nueva })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  const handleCambiarColor = async (nuevoColor: string | null) => {
    if (nuevoColor === colorLinea) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ color_linea_bracket: nuevoColor })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  const handleCambiarEstiloTitulo = async (nuevo: EstiloTituloBracket) => {
    if (nuevo === estiloTitulo) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ estilo_titulo_bracket: nuevo })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  const handleCambiarColorTexto = async (nuevoColor: string | null) => {
    if (nuevoColor === colorTexto) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ color_texto_bracket: nuevoColor })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  const handleCambiarColorTextoTitulo = async (nuevoColor: string | null) => {
    if (nuevoColor === colorTextoTitulo) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ color_texto_titulo_bracket: nuevoColor })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  const handleCambiarInsignia = async (nueva: InsigniaBracket) => {
    if (nueva === insignia) return;
    setError(null);
    const { error: err } = await supabase
      .from("tournaments")
      .update({ insignia_bracket: nueva })
      .eq("id", tournamentId);
    if (err) setError(err.message);
    else onCambio();
  };

  return (
    <div className="bracket-picker">
      {error && <div className="form-error">{error}</div>}

      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Estructura</h3>
        <div className="bracket-picker-options estructura-picker-options">
          {ESTRUCTURA_BRACKET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option estructura-picker-option ${estructura === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarEstructura(o.value)}
            >
              <PreviewEstructura variante={o.value} />
              <span className="bracket-picker-option-label">{o.label}</span>
              <span className="estructura-picker-desc">{o.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Efectos de líneas</h3>
        <div className="bracket-picker-options">
          {ESTILO_LINEA_BRACKET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option ${estiloLinea === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarLinea(o.value)}
            >
              <MiniLinea estiloLinea={o.value} colorLinea={colorLinea} />
              <span className="bracket-picker-option-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Migración 179, a pedido del usuario: paleta para personalizar
          el color de cualquiera de los 3 efectos de arriba -- "Por
          defecto" vuelve al color de siempre de cada uno
          (color_linea_bracket = null). */}
      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Color de línea</h3>
        <div className="bracket-picker-options">
          <button
            type="button"
            className={`bracket-picker-option ${colorLinea === null ? "selected" : ""}`}
            onClick={() => handleCambiarColor(null)}
          >
            <div className="bracket-color-linea-preview bracket-color-linea-preview-defecto" />
            <span className="bracket-picker-option-label">Por defecto</span>
          </button>
          {PALETA_COLOR_LINEA_BRACKET.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option ${colorLinea === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarColor(o.value)}
            >
              <div className="bracket-color-linea-preview" style={{ background: o.value }} />
              <span className="bracket-picker-option-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Migración 181, a pedido del usuario: "modelos" de la franja con
          el nombre del torneo -- solo cambia algo visible con estilo
          "esports" (el único que muestra esta franja), pero se deja
          elegible siempre para que quede listo al cambiar de estilo. */}
      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Estilo de título</h3>
        <div className="bracket-picker-options">
          {ESTILO_TITULO_BRACKET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option ${estiloTitulo === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarEstiloTitulo(o.value)}
            >
              <PreviewTitulo estiloTitulo={o.value} />
              <span className="bracket-picker-option-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Migración 181, a pedido del usuario: color del texto de los
          nombres DENTRO de la llave -- misma paleta y mismo patrón que
          "Color de línea" de arriba ("Por defecto" = sin personalizar). */}
      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Color de texto (llave)</h3>
        <div className="bracket-picker-options">
          <button
            type="button"
            className={`bracket-picker-option ${colorTexto === null ? "selected" : ""}`}
            onClick={() => handleCambiarColorTexto(null)}
          >
            <div className="bracket-color-linea-preview bracket-color-linea-preview-defecto" />
            <span className="bracket-picker-option-label">Por defecto</span>
          </button>
          {PALETA_COLOR_TEXTO_BRACKET.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option ${colorTexto === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarColorTexto(o.value)}
            >
              <div className="bracket-color-linea-preview" style={{ background: o.value }} />
              <span className="bracket-picker-option-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Migración 181, a pedido del usuario: color del texto de la
          franja del título -- independiente del de arriba, misma paleta. */}
      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Color de texto (título)</h3>
        <div className="bracket-picker-options">
          <button
            type="button"
            className={`bracket-picker-option ${colorTextoTitulo === null ? "selected" : ""}`}
            onClick={() => handleCambiarColorTextoTitulo(null)}
          >
            <div className="bracket-color-linea-preview bracket-color-linea-preview-defecto" />
            <span className="bracket-picker-option-label">Por defecto</span>
          </button>
          {PALETA_COLOR_TEXTO_BRACKET.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option ${colorTextoTitulo === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarColorTextoTitulo(o.value)}
            >
              <div className="bracket-color-linea-preview" style={{ background: o.value }} />
              <span className="bracket-picker-option-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Migración 182, a pedido del usuario: qué se muestra junto al
          nombre de cada participante dentro de la llave. */}
      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Insignia del participante</h3>
        <div className="bracket-picker-options">
          {INSIGNIA_BRACKET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option ${insignia === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarInsignia(o.value)}
            >
              <span className="bracket-picker-option-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="bracket-picker-group">
        <h3 className="detail-subtitle">Fondo</h3>
        <div className="bracket-picker-options">
          {FONDO_BRACKET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`bracket-picker-option ${fondo === o.value ? "selected" : ""}`}
              onClick={() => handleCambiarFondo(o.value)}
            >
              <div className="bracket-fondo-preview" data-fondo-bracket={o.value} />
              <span className="bracket-picker-option-label">{o.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
