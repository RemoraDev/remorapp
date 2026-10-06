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
}: {
  equipo: { nombre: string; tag: string; logo_url: string | null };
  lado: "challenger" | "challenged";
  streamLink: string | null;
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
            de "sin stream". Corrección (migración 135): acá va siempre
            el texto genérico "Stream", nunca el nick del streamer --
            ya sale bien visible en la franja destacada de arriba
            (StreamerBanner); repetirlo acá abajo del equipo quedaba
            redundante. */}
        {streamLink && (
          <a href={streamLink} target="_blank" rel="noreferrer noopener" className="lineup-card-equipo-stream">
            Stream
          </a>
        )}
      </div>
    </div>
  );
}

// Migración 131: el streamer tiene que salir bien visible en pantalla,
// en las 4 maquetas por igual -- antes solo había un link chico bajo
// el nombre del equipo (EquipoHeader), fácil de pasar por alto. Cada
// equipo puede tener el suyo propio (challenger_stream_link/
// challenged_stream_link, migración 125, independientes entre sí);
// acá se juntan los que estén cargados en una franja destacada arriba
// de todo, con un punto "en vivo" pulsante -- y si ninguno de los dos
// cargó un link, lo dice explícitamente en vez de quedar vacío.
// Migración 132: se exporta para que la página del lobby pueda
// mostrar la misma franja incluso ANTES de que se revele el lineup
// (acá adentro solo se monta una vez ya revelado). Migración 133:
// suma el nombre del streamer (si no se cargó, muestra el nombre del
// equipo) y el delay en segundos, aparte, sin competir visualmente con
// el punto "en vivo".
//
// Migración 135: el nombre del streamer se busca en el roster propio
// (migración 133), que ya viene como "Nick#12345" -- ese "#12345" es
// el ID interno del jugador, no algo para mostrarle al público, así
// que se recorta acá antes de mostrarlo. Además, el link del stream
// ahora se ve como texto de verdad abajo del nombre (antes solo el
// nombre era clickeable, sin mostrar el link en sí).
function quitarTagPrivado(nombre: string): string {
  return nombre.replace(/#\d+$/, "");
}

export function StreamerBanner({ datos }: { datos: LineupPublicoClanWar }) {
  const activos = [
    datos.challenger_stream_link
      ? {
          nombre: quitarTagPrivado(datos.challenger_streamer_nombre ?? datos.challenger.nombre),
          link: datos.challenger_stream_link,
          delay: datos.challenger_stream_delay,
        }
      : null,
    datos.challenged_stream_link
      ? {
          nombre: quitarTagPrivado(datos.challenged_streamer_nombre ?? datos.challenged.nombre),
          link: datos.challenged_stream_link,
          delay: datos.challenged_stream_delay,
        }
      : null,
  ].filter((s): s is { nombre: string; link: string; delay: number } => s !== null);

  return (
    <div className="lineup-card-streamer-banner">
      {activos.length === 0 ? (
        <span className="lineup-card-streamer-vacio">Sin Streamer Presente</span>
      ) : (
        activos.map((s) => (
          <div key={s.nombre} className="lineup-card-streamer-item">
            <span className="lineup-card-streamer-fila">
              {/* Corrección: el nick tiene que verse como un link de
                  verdad (no solo texto blanco con un href escondido
                  detrás) -- fondo/borde de color + subrayado. */}
              <a href={s.link} target="_blank" rel="noreferrer noopener" className="lineup-card-streamer-activo">
                <span className="lineup-card-streamer-dot" />
                En vivo: <span className="lineup-card-streamer-nick">{s.nombre}</span>
              </a>
              {/* Corrección: el delay quedaba demasiado chico y apagado
                  -- ahora es su propia insignia, bien visible. */}
              {s.delay > 0 && <span className="lineup-card-streamer-delay">Delay {s.delay} segundos</span>}
            </span>
            {/* Corrección: el link en sí tiene que aparecer visible,
                abajo, no solo escondido detrás del nombre. */}
            <a href={s.link} target="_blank" rel="noreferrer noopener" className="lineup-card-streamer-url">
              {s.link}
            </a>
          </div>
        ))
      )}
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
      <StreamerBanner datos={datos} />
      <div className="lineup-card-header">
        <EquipoHeader
          equipo={datos.challenger}
          lado="challenger"
          streamLink={datos.challenger_stream_link}
        />
        <EquipoHeader
          equipo={datos.challenged}
          lado="challenged"
          streamLink={datos.challenged_stream_link}
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

// Maqueta "Enfrentamientos" (migración 130): en vez de una sola tabla
// con una fila por enfrentamiento (como "Clásico"), cada enfrentamiento
// es su propia tarjeta chica, lado a lado con las demás -- estilo
// habitual de los broadcasts de juegos 1 vs 1 (cada duelo, su propio
// recuadro).
function TarjetaEnfrentamientos({ datos, filas }: { datos: LineupPublicoClanWar; filas: Fila[] }) {
  return (
    <div className="lineup-card-overlay">
      <StreamerBanner datos={datos} />
      <div className="lineup-card-header">
        <EquipoHeader
          equipo={datos.challenger}
          lado="challenger"
          streamLink={datos.challenger_stream_link}
        />
        <EquipoHeader
          equipo={datos.challenged}
          lado="challenged"
          streamLink={datos.challenged_stream_link}
        />
      </div>

      <div className="lineup-enfrentamientos-fila">
        {filas.map((fila, indice) => (
          <div key={indice} className="lineup-enfrentamientos-duelo">
            <div className="lineup-enfrentamientos-jugador">
              <RazaBadge raza={fila.challenger?.raza ?? null} lado="challenger" />
              <span className="lineup-card-jugador-nombre">{fila.challenger?.nombre ?? "Por definir"}</span>
            </div>
            <span className="lineup-card-vs">VS</span>
            <div className="lineup-enfrentamientos-jugador">
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

// Maqueta "Póster" (migración 130): split vertical al estilo cartel de
// versus/character-select -- cada equipo ocupa su mitad completa, con
// un "VS" grande al centro en vez del marcador angosto de "Cascada".
function TarjetaPoster({ datos, filas }: { datos: LineupPublicoClanWar; filas: Fila[] }) {
  return (
    <div className="lineup-card-overlay lineup-poster-overlay">
      <StreamerBanner datos={datos} />
      <div className="lineup-poster-split">
        <div className="lineup-poster-mitad lineup-poster-mitad-challenger">
          <EquipoHeader
            equipo={datos.challenger}
            lado="challenger"
            streamLink={datos.challenger_stream_link}
          />
          <div className="lineup-poster-jugadores">
            {filas.map((fila, indice) => (
              <div key={indice} className="lineup-poster-jugador">
                <RazaBadge raza={fila.challenger?.raza ?? null} lado="challenger" />
                <span className="lineup-card-jugador-nombre">{fila.challenger?.nombre ?? "Por definir"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lineup-poster-vs">
          <span className="lineup-poster-vs-texto">VS</span>
        </div>

        <div className="lineup-poster-mitad lineup-poster-mitad-challenged">
          <EquipoHeader
            equipo={datos.challenged}
            lado="challenged"
            streamLink={datos.challenged_stream_link}
          />
          <div className="lineup-poster-jugadores">
            {filas.map((fila, indice) => (
              <div key={indice} className="lineup-poster-jugador">
                <RazaBadge raza={fila.challenged?.raza ?? null} lado="challenged" />
                <span className="lineup-card-jugador-nombre">{fila.challenged?.nombre ?? "Por definir"}</span>
              </div>
            ))}
          </div>
        </div>
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
      <StreamerBanner datos={datos} />
      <div className="lineup-cascada-equipo lineup-cascada-equipo-top">
        <EquipoHeader
          equipo={datos.challenger}
          lado="challenger"
          streamLink={datos.challenger_stream_link}
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
        />
      </div>

      <CasterFooter datos={datos} />
    </div>
  );
}

const MAQUETAS: Record<LineupPublicoClanWar["estructura"], (props: { datos: LineupPublicoClanWar; filas: Fila[] }) => JSX.Element> = {
  clasico: TarjetaClasica,
  cascada: TarjetaCascada,
  enfrentamientos: TarjetaEnfrentamientos,
  poster: TarjetaPoster,
};

// Tarjeta de lineup con el mismo lenguaje visual de un marcador de
// esports -- la maqueta (Clásico, Cascada, Enfrentamientos o Póster) y
// la dimensión (4:3, 16:9, 16:10, 21:9) las elige el capitán o el
// caster desde "Look" en el lobby del evento (migraciones 127, 129 y
// 130). El fondo es el mismo para las cuatro maquetas (imagen del
// catálogo, o uno de los fondos clásicos si no eligieron ninguna
// imagen).
export default function TarjetaLineupClanWar({ datos }: { datos: LineupPublicoClanWar }) {
  const filas = filasEnfrentamiento(datos);
  const conFondoImagen = !!datos.fondo_imagen_url;
  const Maqueta = MAQUETAS[datos.estructura] ?? TarjetaClasica;
  const aspectoClase = `lineup-card-aspecto-${datos.aspecto.replace(":", "-")}`;

  // Migración 162: Clan War interna (mismo clan retándose a sí mismo,
  // para practicar) -- challenger_team_id === challenged_team_id, así
  // que datos.challenger.nombre y datos.challenged.nombre vendrían
  // idénticos ("vs sí mismo" en pantalla). Se resuelve una sola vez
  // acá, antes de la maqueta, así las 4 (Clásica/Cascada/
  // Enfrentamientos/Póster) y el StreamerBanner ya reciben nombres
  // distintos sin que cada una tenga que volver a chequear el caso.
  const esInterna = datos.challenger_team_id === datos.challenged_team_id;
  const datosParaMostrar = esInterna
    ? {
        ...datos,
        challenger: { ...datos.challenger, nombre: `${datos.challenger.tag} A` },
        challenged: { ...datos.challenged, nombre: `${datos.challenged.tag} B` },
      }
    : datos;

  return (
    <div
      className={`lineup-card ${aspectoClase} ${datos.estructura === "cascada" ? "lineup-card-cascada" : ""}`}
      data-fondo-lineup={conFondoImagen ? undefined : datos.fondo_clasico}
      style={{
        aspectRatio: datos.aspecto.replace(":", " / "),
        ...(conFondoImagen ? { backgroundImage: `url(${datos.fondo_imagen_url})` } : {}),
      }}
    >
      <Maqueta datos={datosParaMostrar} filas={filas} />
    </div>
  );
}
