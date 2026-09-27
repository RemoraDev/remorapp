import type { LineupPublicoClanWar, LineupPublicoJugador } from "../types/clanWars";

interface Fila {
  challenger: LineupPublicoJugador | null;
  challenged: LineupPublicoJugador | null;
}

// En WTL las 3 posiciones son fijas (1/2/3 de cada lado, ver
// clan_war_lineup.posicion) -- en "simple" el lineup es una lista
// suelta sin posición formal, así que se empareja por orden nomás,
// fila a fila, hasta el más largo de los dos lados.
function filasEnfrentamiento(datos: LineupPublicoClanWar): Fila[] {
  const challenger = datos.lineup_challenger ?? [];
  const challenged = datos.lineup_challenged ?? [];

  if (datos.formato === "wtl") {
    return [1, 2, 3].map((pos) => ({
      challenger: challenger.find((j) => j.posicion === pos) ?? null,
      challenged: challenged.find((j) => j.posicion === pos) ?? null,
    }));
  }

  const total = Math.max(challenger.length, challenged.length, 1);
  return Array.from({ length: total }, (_, i) => ({
    challenger: challenger[i] ?? null,
    challenged: challenged[i] ?? null,
  }));
}

// Emblemas oficiales de cada raza (public/razas/) -- recortados y con
// fondo transparente a partir de las imágenes de referencia.
const ICONO_RAZA: Record<NonNullable<LineupPublicoJugador["raza"]>, string> = {
  Zerg: "/razas/zerg.webp",
  Protoss: "/razas/protoss.webp",
  Terran: "/razas/terran.webp",
};

function RazaBadge({ raza, lado }: { raza: LineupPublicoJugador["raza"]; lado: "challenger" | "challenged" }) {
  return (
    <span className={`lineup-card-raza-badge lineup-card-raza-badge-${lado}`} title={raza ?? "Raza no definida"}>
      {raza ? <img src={ICONO_RAZA[raza]} alt={raza} className="lineup-card-raza-icono" /> : "?"}
    </span>
  );
}

function EquipoHeader({
  equipo,
  lado,
  streamLink,
  streamDelay,
}: {
  equipo: { nombre: string; tag: string; logo_url: string | null };
  lado: "challenger" | "challenged";
  streamLink: string | null;
  streamDelay: boolean | null;
}) {
  return (
    <div className={`lineup-card-equipo lineup-card-equipo-${lado}`}>
      {/* Corrección: sin logo, antes se mostraba un placeholder genérico
          ("TEAM 1"/"TEAM 2") en vez del nombre real del equipo, que sí
          estaba disponible -- el logo es opcional, el nombre no. */}
      {equipo.logo_url && <img src={equipo.logo_url} alt="" className="lineup-card-logo" />}
      <div className="lineup-card-equipo-texto">
        <span className="lineup-card-equipo-nombre">{equipo.nombre}</span>
        {/* Migración 125: stream propio de cada equipo -- solo se
            muestra al público si ese equipo lo cargó, nunca un mensaje
            de "sin stream". */}
        {streamLink && (
          <a href={streamLink} target="_blank" rel="noreferrer noopener" className="lineup-card-equipo-stream">
            Stream{streamDelay ? " (con delay)" : ""}
          </a>
        )}
      </div>
    </div>
  );
}

function CasterFooter({ datos }: { datos: LineupPublicoClanWar }) {
  if (!datos.caster_nombre && !datos.caster_link) return null;
  return (
    <div className="lineup-card-caster">
      <span>Caster: {datos.caster_nombre ?? "Por confirmar"}</span>
      {datos.caster_link && (
        <a href={datos.caster_link} target="_blank" rel="noreferrer noopener">
          {datos.caster_link}
        </a>
      )}
    </div>
  );
}

// Maqueta "Clásico" (default de siempre): equipos arriba lado a lado,
// una fila por enfrentamiento (ícono de raza, nombre, marcador 0-0 de
// referencia, "VS").
function TarjetaClasica({ datos, filas }: { datos: LineupPublicoClanWar; filas: Fila[] }) {
  return (
    <div className="lineup-card-overlay">
      <div className="lineup-card-header">
        <EquipoHeader
          equipo={datos.challenger}
          lado="challenger"
          streamLink={datos.challenger_stream_link}
          streamDelay={datos.challenger_stream_delay}
        />
        <span className="lineup-card-brand">RemorApp</span>
        <EquipoHeader
          equipo={datos.challenged}
          lado="challenged"
          streamLink={datos.challenged_stream_link}
          streamDelay={datos.challenged_stream_delay}
        />
      </div>

      <div className="lineup-card-filas">
        {filas.map((fila, indice) => (
          <div key={indice} className="lineup-card-fila">
            <div className="lineup-card-jugador lineup-card-jugador-challenger">
              <span className="lineup-card-jugador-nombre">{fila.challenger?.nombre ?? "Por definir"}</span>
              <RazaBadge raza={fila.challenger?.raza ?? null} lado="challenger" />
            </div>
            <span className="lineup-card-marcador">0</span>
            <span className="lineup-card-vs">VS</span>
            <span className="lineup-card-marcador">0</span>
            <div className="lineup-card-jugador lineup-card-jugador-challenged">
              <RazaBadge raza={fila.challenged?.raza ?? null} lado="challenged" />
              <span className="lineup-card-jugador-nombre">{fila.challenged?.nombre ?? "Por definir"}</span>
            </div>
          </div>
        ))}
      </div>

      <CasterFooter datos={datos} />
    </div>
  );
}

// Maqueta "Cascada" (migración 127): el challenger arriba, con sus
// jugadores en una fila horizontal; marcador grande al centro; el
// challenged abajo, mismo criterio. Pensada para un estilo más de
// "presentación de torneo" que la clásica lado a lado.
function TarjetaCascada({ datos, filas }: { datos: LineupPublicoClanWar; filas: Fila[] }) {
  return (
    <div className="lineup-card-overlay lineup-cascada-overlay">
      <div className="lineup-cascada-equipo lineup-cascada-equipo-top">
        <EquipoHeader
          equipo={datos.challenger}
          lado="challenger"
          streamLink={datos.challenger_stream_link}
          streamDelay={datos.challenger_stream_delay}
        />
        <div className="lineup-cascada-jugadores">
          {filas.map((fila, indice) => (
            <div key={indice} className="lineup-cascada-jugador">
              <RazaBadge raza={fila.challenger?.raza ?? null} lado="challenger" />
              <span className="lineup-card-jugador-nombre">{fila.challenger?.nombre ?? "Por definir"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="lineup-cascada-marcador">
        <div className="lineup-cascada-marcador-fila">
          <span className="lineup-cascada-marcador-num">0</span>
          <span className="lineup-card-vs">VS</span>
          <span className="lineup-cascada-marcador-num">0</span>
        </div>
        <span className="lineup-card-brand lineup-cascada-brand">RemorApp</span>
      </div>

      <div className="lineup-cascada-equipo lineup-cascada-equipo-bottom">
        <div className="lineup-cascada-jugadores">
          {filas.map((fila, indice) => (
            <div key={indice} className="lineup-cascada-jugador">
              <RazaBadge raza={fila.challenged?.raza ?? null} lado="challenged" />
              <span className="lineup-card-jugador-nombre">{fila.challenged?.nombre ?? "Por definir"}</span>
            </div>
          ))}
        </div>
        <EquipoHeader
          equipo={datos.challenged}
          lado="challenged"
          streamLink={datos.challenged_stream_link}
          streamDelay={datos.challenged_stream_delay}
        />
      </div>

      <CasterFooter datos={datos} />
    </div>
  );
}

// Tarjeta de lineup con el mismo lenguaje visual de un marcador de
// esports -- la maqueta (clásico lado a lado, o cascada) la elige el
// capitán o el caster desde "Look -> Estructura" en el lobby del
// evento (migración 127). El fondo es el mismo para las dos maquetas
// (imagen del catálogo, o uno de los fondos clásicos si no eligieron
// ninguna imagen).
export default function TarjetaLineupClanWar({ datos }: { datos: LineupPublicoClanWar }) {
  const filas = filasEnfrentamiento(datos);
  const conFondoImagen = !!datos.fondo_imagen_url;

  return (
    <div
      className={`lineup-card ${datos.estructura === "cascada" ? "lineup-card-cascada" : ""}`}
      data-fondo-lineup={conFondoImagen ? undefined : datos.fondo_clasico}
      style={conFondoImagen ? { backgroundImage: `url(${datos.fondo_imagen_url})` } : undefined}
    >
      {datos.estructura === "cascada" ? (
        <TarjetaCascada datos={datos} filas={filas} />
      ) : (
        <TarjetaClasica datos={datos} filas={filas} />
      )}
    </div>
  );
}
