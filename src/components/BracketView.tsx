import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Avatar from "./Avatar";
import type { BracketMatchRow } from "../types/bracket";
import type {
  EstiloBracket,
  EstiloLineaBracket,
  EstructuraBracket,
  EstiloTituloBracket,
  InsigniaBracket,
} from "../types/tournaments";

// Migración 182: el emoji de bandera (🇨🇱, etc.) depende de que el
// sistema operativo tenga una fuente con glifos de emoji de bandera --
// Windows no la tiene por default y cae a mostrar el código de país en
// texto plano ("CL"). Se reemplaza por flag-icons (SVG reales,
// paquete instalado, sin depender de ningún CDN externo) -- cada país
// de profiles.country mapea a su código ISO 3166-1 alpha-2.
const BANDERA_ISO: Record<string, string> = {
  chile: "cl",
  guatemala: "gt",
  puerto_rico: "pr",
  argentina: "ar",
  peru: "pe",
  bolivia: "bo",
};

interface BracketViewProps {
  matches: BracketMatchRow[];
  // tournament_participants.id -> nombre para mostrar (nombre del
  // jugador en 1v1, nombre del equipo en 2v2/3v3/4v4).
  nombresPorParticipante: Record<string, string>;
  // tournament_participants.id -> logo del equipo (solo en torneos por
  // equipo; en 1v1 no se pasa este prop). Se muestra en los 3 estilos
  // por igual, sin cambios -- así se veía siempre en un torneo por
  // equipo.
  logosPorParticipante?: Record<string, string | null>;
  // tournament_participants.id -> avatar de perfil, en TODOS los
  // torneos (1v1 incluido). Solo se usa cuando estilo es "esports" Y
  // no llegó logosPorParticipante (1v1) -- "clasico"/"starcraft_oficial"
  // en 1v1 siguen sin mostrar foto, igual que siempre.
  avatarsPorParticipante?: Record<string, string | null>;
  // Migración 040: layout de cajas -- puramente visual, ver halcon.css
  // (selectores [data-estilo-bracket="..."]).
  estilo: EstiloBracket;
  // Migración 176, a pedido del usuario: efecto de la línea de
  // conexión entre rondas, independiente del estilo de caja de arriba
  // -- "ninguno" no dibuja líneas (antes dependía de estilo ===
  // "esports"/"starcraft_oficial"; ver halcon.css, selectores
  // [data-estilo-linea="..."]).
  estiloLinea: EstiloLineaBracket;
  // Migración 179, a pedido del usuario: color personalizado para
  // cualquiera de los 3 efectos de línea -- null usa el color de
  // siempre de cada uno (ver --linea-color en halcon.css).
  colorLinea: string | null;
  // Migración 177, a pedido del usuario: cómo se arma la llave en sí
  // (no solo su piel) -- "clasico" es el de siempre.
  estructura: EstructuraBracket;
  // Nombre del torneo, para la franja superior del estilo "esports".
  nombreTorneo: string;
  // Migración 181, a pedido del usuario: "modelo" de esa franja (solo
  // aplica con estilo "esports") -- ver selectores [data-estilo-titulo]
  // en halcon.css.
  estiloTitulo: EstiloTituloBracket;
  // Migración 181, a pedido del usuario: color personalizado del texto
  // de los nombres dentro de la llave, y del texto de la franja del
  // título -- null usa el color de siempre de cada uno.
  colorTexto: string | null;
  colorTextoTitulo: string | null;
  // Migración 184, a pedido del usuario: apaga la animación de brillo
  // de la franja del título (cualquiera de los 11 modelos) sin
  // cambiar de modelo.
  tituloAnimado: boolean;
  // Migración 185, a pedido del usuario: fuente de texto libre (los
  // nombres dentro de la llave Y el título) y tamaño de letra del
  // título -- null en cualquiera de los dos usa el de siempre.
  fuenteTexto: string | null;
  tamanoFuenteTitulo: number | null;
  // Migración 182, a pedido del usuario: qué se muestra junto al
  // nombre de cada participante -- "logo_personal" (default) reproduce
  // el comportamiento de siempre (logosPorParticipante/avatarsPorParticipante,
  // ver logoDe más abajo); "bandera"/"banner_clan"/"ninguno" lo
  // reemplazan por completo.
  insignia: InsigniaBracket;
  // tournament_participants.id -> profiles.country (solo torneos 1v1),
  // usado cuando insignia === "bandera".
  paisesPorParticipante?: Record<string, string | null>;
  // tournament_participants.id -> teams.banner_url (solo torneos por
  // equipo), usado cuando insignia === "banner_clan".
  bannersPorParticipante?: Record<string, string | null>;
  // Migración 069: en vez de "Ronda 1/2/3", muestra el nombre
  // tradicional (Octavos/Cuartos/Semifinal/Final) según qué tan cerca
  // esté esa ronda de la final.
  nombresRondaPersonalizados?: boolean;
  // Migración 069: en false, el organizador desactivó el autoreporte --
  // los botones de reportar ni se muestran a los propios participantes.
  permiteAutoreporte?: boolean;
  // tournament_participants.id -> si el usuario logueado puede
  // reportar por ese participante: ya viene resuelto desde afuera
  // (BracketView no sabe ni le importa si el torneo es 1v1 o por
  // equipo -- en 1v1 es "soy yo", en equipo es "soy el dueño de ese
  // equipo", pero acá ya llega como un booleano listo).
  puedeReportarPorParticipante: Record<string, boolean>;
  userId: string | null;
  organizadorId: string;
  onCambio: () => void;
  // Migración 090: en un torneo formato "wtl", el tag y el
  // tournament_participants.id de mi propio equipo -- se usan para
  // decidir si le muestro el link "Ir a la Clan War" (soy parte de
  // ESE cruce puntual) o solo el aviso genérico. Mismo patrón que
  // GroupStage.tsx.
  miEquipoTag?: string | null;
  miParticipantId?: string | null;
}

// Estimación del alto de UN partido -- fija la altura total del
// bracket (ver armarGrilla más abajo). Subido de 96 a 150: con
// overflow: hidden en .bracket (ver halcon.css, necesario para que
// nunca aparezca scroll), un partido más alto que su "cupo" quedaba
// recortado -- el caso más alto es uno sin resultado con los dos
// botones de "Ganó X/Y" visibles.
const ALTURA_PARTIDO_PX = 150;
// Estimación del ancho de UN partido en la estructura "vertical" (ver
// halcon.css, .bracket-vertical .bracket-match { width: 12rem }) --
// reusar ALTURA_PARTIDO_PX acá era un bug: 150px de "cupo" para una
// tarjeta de 12rem (192px) la apretaba/recortaba.
const ANCHO_PARTIDO_PX = 220;

interface ConectorLinea {
  key: string;
  d: string;
}

export default function BracketView({
  matches,
  nombresPorParticipante,
  logosPorParticipante,
  avatarsPorParticipante,
  estilo,
  estiloLinea,
  colorLinea,
  estructura,
  nombreTorneo,
  estiloTitulo,
  colorTexto,
  colorTextoTitulo,
  tituloAnimado,
  fuenteTexto,
  tamanoFuenteTitulo,
  insignia,
  paisesPorParticipante,
  bannersPorParticipante,
  nombresRondaPersonalizados,
  permiteAutoreporte = true,
  puedeReportarPorParticipante,
  userId,
  organizadorId,
  onCambio,
  miEquipoTag = null,
  miParticipantId = null,
}: BracketViewProps) {
  const [reportando, setReportando] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});

  // Líneas de conexión entre rondas (solo estilos "esports"/"starcraft
  // oficial") -- antes era un acento de CSS de ancho fijo, sin relación
  // real con dónde caía cada partido (se notaba mal apenas una ronda
  // tenía partidos de alturas distintas, por ejemplo uno con los
  // botones de "Ganó X/Y" visibles y otro ya resuelto sin ellos). Ahora
  // se miden las posiciones reales en el DOM y se dibuja un trazo SVG
  // que conecta el borde derecho de cada partido con el borde
  // izquierdo del partido de la ronda siguiente que le corresponde.
  const matchElRefs = useRef(new Map<string, HTMLDivElement>());
  const grillaElRefs = useRef(new Map<string, HTMLDivElement>());
  const [conectoresPorGrilla, setConectoresPorGrilla] = useState<Record<string, ConectorLinea[]>>({});
  const [tamanoPorGrilla, setTamanoPorGrilla] = useState<Record<string, { ancho: number; alto: number }>>({});

  const muestraConectores = estiloLinea !== "ninguno";
  // Migración 177: "vertical" rota todo el árbol -- las rondas quedan
  // apiladas de arriba hacia abajo en vez de en columnas, así que el
  // trazo de conexión también tiene que salir del borde de ABAJO de
  // cada partido (no del derecho) y entrar por ARRIBA del siguiente.
  const esVertical = estructura === "vertical";
  // Migración 187, a pedido del usuario: "escalera" reemplaza a
  // "compacta" -- reutiliza el mismo armado por columnas de "clasico"
  // (renderGrilla/renderPartido tal cual, ver más abajo), solo
  // escalona cada partido en zigzag vía CSS ([data-estructura="escalera"],
  // ver halcon.css) -- no hace falta ninguna función de render propia.
  const esEmbudo = estructura === "embudo";
  // Migración 189: qué sub-vista del modo "llave grande" (Grupo
  // A/Grupo B/Vista panorámica, ver esLlaveGrande más abajo) está
  // activa -- declarado acá arriba (no junto a esLlaveGrande) porque el
  // useLayoutEffect de abajo necesita re-medir cuando cambia.
  const [vistaGrupo, setVistaGrupo] = useState<"a" | "b" | "panoramica">("a");

  useLayoutEffect(() => {
    if (!muestraConectores) return;

    const medir = () => {
      const nuevosConectores: Record<string, ConectorLinea[]> = {};
      const nuevosTamanos: Record<string, { ancho: number; alto: number }> = {};

      grillaElRefs.current.forEach((contenedor, keyPrefix) => {
        const rectContenedor = contenedor.getBoundingClientRect();
        nuevosTamanos[keyPrefix] = { ancho: contenedor.scrollWidth, alto: contenedor.scrollHeight };

        const porRonda = new Map<number, { el: HTMLDivElement; matchNumber: number }[]>();
        matchElRefs.current.forEach((el, matchKey) => {
          const [prefijo, rondaStr, matchNumberStr] = matchKey.split("::");
          if (prefijo !== keyPrefix) return;
          const ronda = Number(rondaStr);
          const lista = porRonda.get(ronda) ?? [];
          lista.push({ el, matchNumber: Number(matchNumberStr) });
          porRonda.set(ronda, lista);
        });

        const rondas = [...porRonda.keys()].sort((a, b) => a - b);
        const lineas: ConectorLinea[] = [];

        for (let i = 0; i < rondas.length - 1; i++) {
          const actual = (porRonda.get(rondas[i]) ?? []).sort((a, b) => a.matchNumber - b.matchNumber);
          const siguiente = (porRonda.get(rondas[i + 1]) ?? []).sort((a, b) => a.matchNumber - b.matchNumber);

          actual.forEach(({ el, matchNumber }) => {
            const destino = siguiente.find((s) => s.matchNumber === Math.ceil(matchNumber / 2));
            if (!destino) return;

            const r1 = el.getBoundingClientRect();
            const r2 = destino.el.getBoundingClientRect();
            let d: string;

            if (esVertical) {
              const x1 = r1.left + r1.width / 2 - rectContenedor.left;
              const y1 = r1.bottom - rectContenedor.top;
              const x2 = r2.left + r2.width / 2 - rectContenedor.left;
              const y2 = r2.top - rectContenedor.top;
              const yMedio = y1 + (y2 - y1) / 2;
              d = `M ${x1} ${y1} V ${yMedio} H ${x2} V ${y2}`;
            } else if (keyPrefix === "embudo-der") {
              // Migración 177, corrección: la mitad derecha del "embudo
              // al centro" se probó primero espejando con CSS
              // (transform: scaleX(-1)) -- pero el propio <svg> de las
              // líneas quedaba DENTRO de ese mismo espejo, así que el
              // trazo (calculado con la posición ya espejada de cada
              // partido) se espejaba una segunda vez al pintarse,
              // desalineándose por completo. Ahora, en vez de espejar
              // con CSS, esta mitad simplemente RENDERIZA sus rondas en
              // orden inverso (ver renderGrilla, invertir) y acá se usa
              // la fórmula en espejo (sale del borde IZQUIERDO de cada
              // partido, entra por el DERECHO del siguiente) -- sin
              // ningún transform de por medio, nada se desalinea.
              const x1 = r1.left - rectContenedor.left;
              const y1 = r1.top + r1.height / 2 - rectContenedor.top;
              const x2 = r2.right - rectContenedor.left;
              const y2 = r2.top + r2.height / 2 - rectContenedor.top;
              const xMedio = x1 + (x2 - x1) / 2;
              d = `M ${x1} ${y1} H ${xMedio} V ${y2} H ${x2}`;
            } else {
              const x1 = r1.right - rectContenedor.left;
              const y1 = r1.top + r1.height / 2 - rectContenedor.top;
              const x2 = r2.left - rectContenedor.left;
              const y2 = r2.top + r2.height / 2 - rectContenedor.top;
              const xMedio = x1 + (x2 - x1) / 2;
              d = `M ${x1} ${y1} H ${xMedio} V ${y2} H ${x2}`;
            }

            lineas.push({ key: `${keyPrefix}-${rondas[i]}-${matchNumber}`, d });
          });
        }

        nuevosConectores[keyPrefix] = lineas;
      });

      // "Embudo al centro": las líneas de arriba conectan rondas
      // DENTRO de cada mitad, pero ninguna llegaba a la Final (una
      // cajita aparte, fuera de ambas grillas) -- acá se agregan las 2
      // que faltan, izquierda->Final y derecha->Final, usando
      // .bracket-embudo-wrap como referencia en vez de cada .bracket
      // por separado.
      const wrapEmbudo = grillaElRefs.current.get("embudo-wrap");
      const elFinal = matchElRefs.current.get("embudo-final::0::1");
      if (wrapEmbudo && elFinal) {
        const rectWrap = wrapEmbudo.getBoundingClientRect();
        const rFinal = elFinal.getBoundingClientRect();
        const lineasEmbudo: ConectorLinea[] = [];

        let maxRondaIzq = -1;
        let elIzq: HTMLDivElement | null = null;
        let maxRondaDer = -1;
        let elDer: HTMLDivElement | null = null;
        matchElRefs.current.forEach((el, matchKey) => {
          const [prefijo, rondaStr] = matchKey.split("::");
          const ronda = Number(rondaStr);
          if (prefijo === "embudo-izq" && ronda > maxRondaIzq) {
            maxRondaIzq = ronda;
            elIzq = el;
          }
          if (prefijo === "embudo-der" && ronda > maxRondaDer) {
            maxRondaDer = ronda;
            elDer = el;
          }
        });

        if (elIzq) {
          const r1 = (elIzq as HTMLDivElement).getBoundingClientRect();
          const x1 = r1.right - rectWrap.left;
          const y1 = r1.top + r1.height / 2 - rectWrap.top;
          const x2 = rFinal.left - rectWrap.left;
          const y2 = rFinal.top + rFinal.height / 2 - rectWrap.top;
          const xMedio = x1 + (x2 - x1) / 2;
          lineasEmbudo.push({ key: "embudo-izq-final", d: `M ${x1} ${y1} H ${xMedio} V ${y2} H ${x2}` });
        }

        if (elDer) {
          const r1 = (elDer as HTMLDivElement).getBoundingClientRect();
          const x1 = r1.left - rectWrap.left;
          const y1 = r1.top + r1.height / 2 - rectWrap.top;
          const x2 = rFinal.right - rectWrap.left;
          const y2 = rFinal.top + rFinal.height / 2 - rectWrap.top;
          const xMedio = x1 + (x2 - x1) / 2;
          lineasEmbudo.push({ key: "embudo-der-final", d: `M ${x1} ${y1} H ${xMedio} V ${y2} H ${x2}` });
        }

        nuevosConectores["embudo-wrap"] = lineasEmbudo;
        nuevosTamanos["embudo-wrap"] = { ancho: wrapEmbudo.scrollWidth, alto: wrapEmbudo.scrollHeight };
      }

      setConectoresPorGrilla(nuevosConectores);
      setTamanoPorGrilla(nuevosTamanos);
    };

    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [matches, estiloLinea, muestraConectores, esVertical, estructura, vistaGrupo]);

  // El partido por el tercer lugar (migración 046) comparte la ronda
  // de la final pero se muestra aparte, en su propia cajita -- se
  // excluye acá de la grilla normal de rondas.
  const partidoTercerLugar = matches.find((m) => m.es_tercer_lugar) ?? null;

  // Migración 084: "Eliminación doble" reparte los partidos en más de
  // una llave (bracket_tipo). Antes de esta migración TODOS los
  // partidos tenían bracket_tipo 'ganadores' (el valor por defecto),
  // así que este chequeo es 100% retrocompatible: si nunca aparece
  // otro valor, se sigue viendo exactamente como antes (una sola
  // llave, sin secciones).
  const esEliminacionDoble = matches.some((m) => m.bracket_tipo !== "ganadores" && !m.es_tercer_lugar);

  // Migración 189, a pedido del usuario: a partir de 16 participantes
  // (ronda 1 con 8 partidos o más) una sola imagen de llave se vuelve
  // difícil de leer -- se parte en grupos de 8 (Grupo A, Grupo B), cada
  // uno su propia llave de 3 rondas completa, más una "Vista
  // panorámica" que muestra ambos grupos juntos (mismo armado que
  // "Embudo al centro", ver partidosParaEmbudo/renderEmbudo más abajo).
  // Pisa cualquier Estructura elegida -- de ahí el "ya no toma ningún
  // modelo" que reportó el usuario al llegar a este tamaño. Por ahora
  // solo soporta exactamente 2 grupos (16 participantes); 24/32/64
  // quedan para más adelante.
  const esLlaveGrande =
    !esEliminacionDoble &&
    (() => {
      const principales = matches.filter((m) => !m.es_tercer_lugar);
      if (principales.length === 0) return false;
      const rondaMinima = Math.min(...principales.map((m) => m.round));
      return principales.filter((m) => m.round === rondaMinima).length >= 8;
    })();

  // Migración 069: nombre tradicional según la distancia a la final --
  // "distancia 0" es la final, 1 semifinal, 2 cuartos, 3 octavos; más
  // lejos que eso, se queda en "Ronda N" (no hay nombre tradicional
  // para dieciseisavos en adelante que valga la pena mostrar).
  //
  // Corrección: "Final" para la última ronda (1 solo partido) tiene
  // que verse SIEMPRE, no solo cuando el organizador activa "Nombres
  // de ronda personalizados" -- antes esa bandera gateaba si esta
  // función se llamaba siquiera, así que con la bandera apagada la
  // última ronda de un torneo normal decía "Ronda 3" en vez de
  // "Final". permitirFinal es lo único que sigue dependiendo del
  // contexto: en "Llave de ganadores/perdedores" (eliminación doble) y
  // en cada mitad de "Embudo al centro", la última ronda NO es la
  // final real (esa se muestra aparte, en su propia cajita), así que
  // ahí se pasa false.
  const nombreDeRondaTradicional = (
    rondas: number[],
    indiceRonda: number,
    totalRondas: number,
    cantidadPartidos: number,
    permitirFinal: boolean
  ) => {
    if (permitirFinal && cantidadPartidos === 1) return "Final";
    if (!nombresRondaPersonalizados) return `Ronda ${rondas[indiceRonda]}`;
    const distanciaDeLaFinal = totalRondas - 1 - indiceRonda;
    switch (distanciaDeLaFinal) {
      case 1:
        return "Semifinal";
      case 2:
        return "Cuartos de Final";
      case 3:
        return "Octavos de Final";
      default:
        return `Ronda ${rondas[indiceRonda]}`;
    }
  };

  // Arma la grilla de rondas (columnas) para UN subconjunto de
  // partidos (una sola llave) -- reutilizado tal cual para "ganadores"
  // en eliminación simple/First Stand (el caso de siempre, una sola
  // llave) y, en eliminación doble, una vez para "ganadores" y otra
  // para "perdedores".
  const armarGrilla = (
    partidosDeEstaLlave: BracketMatchRow[],
    nombresTradicionales: boolean,
    permiteFinal = true
  ) => {
    const rondas = [...new Set(partidosDeEstaLlave.map((m) => m.round))].sort((a, b) => a - b);
    const partidosPorRonda = rondas.map((r) =>
      partidosDeEstaLlave.filter((m) => m.round === r).sort((a, b) => a.match_number - b.match_number)
    );
    // La ronda 1 siempre tiene la mayor cantidad de partidas: se usa
    // esa altura para las demás columnas, y "justify-content:
    // space-around" (ver .bracket-round en halcon.css) hace que las
    // rondas con menos partidas se centren solas dentro de ese mismo
    // alto -- así se ve el achicamiento típico de una llave sin tener
    // que calcular a mano en qué posición exacta va cada partida.
    const alturaBracket = (partidosPorRonda[0]?.length ?? 1) * (esVertical ? ANCHO_PARTIDO_PX : ALTURA_PARTIDO_PX);
    // Total real de rondas de la llave completa, aunque las rondas
    // siguientes todavía no se hayan creado en bracket_matches (se van
    // generando de a una a medida que se resuelve la anterior) -- se
    // calcula a partir de la cantidad de partidos de la ronda 1, que
    // siempre es una potencia de 2 y no cambia. Usar rondas.length en
    // su lugar nombraría mal las rondas mientras la llave está en
    // curso (por ejemplo, "Semifinal" para lo que en realidad son
    // Cuartos).
    const totalRondasReal = partidosPorRonda[0]
      ? Math.round(Math.log2(partidosPorRonda[0].length)) + 1
      : rondas.length;

    return { rondas, partidosPorRonda, alturaBracket, totalRondasReal, nombresTradicionales, permiteFinal };
  };

  const renderGrilla = (grilla: ReturnType<typeof armarGrilla>, keyPrefix: string) => {
    const lineas = conectoresPorGrilla[keyPrefix] ?? [];
    const tamano = tamanoPorGrilla[keyPrefix];
    // Migración 177: "vertical" fija el ANCHO total (las rondas se
    // apilan de arriba hacia abajo) en vez del alto -- mismo cálculo,
    // ver armarGrilla más arriba.
    // El color personalizado se setea acá, en .bracket (el ancestro
    // común de las líneas Y de los partidos) -- --linea-color hereda
    // por CSS hacia abajo, así el filete celeste de cada tarjeta
    // (estilo "esports") también lo toma, no solo el trazo del <svg>.
    const estiloTamano = {
      ...(esVertical ? { width: `${grilla.alturaBracket}px` } : { height: `${grilla.alturaBracket}px` }),
      ...(colorLinea ? { "--linea-color": colorLinea } : {}),
      ...(colorTexto ? { "--texto-bracket-color": colorTexto } : {}),
      ...(fuenteTexto ? { "--fuente-texto-personalizada": fuenteTexto } : {}),
    } as CSSProperties;

    return (
      <div
        className={`bracket ${esVertical ? "bracket-vertical" : ""}`}
        data-estilo-bracket={estilo}
        data-estructura={estructura}
        style={estiloTamano}
        ref={(el) => {
          if (el) grillaElRefs.current.set(keyPrefix, el);
          else grillaElRefs.current.delete(keyPrefix);
        }}
      >
        {muestraConectores && lineas.length > 0 && tamano && (
          <svg
            className="bracket-conectores"
            data-estilo-linea={estiloLinea}
            width={tamano.ancho}
            height={tamano.alto}
          >
            {lineas.map((linea) => (
              <path key={linea.key} d={linea.d} />
            ))}
          </svg>
        )}

        {(keyPrefix === "embudo-der"
          ? grilla.partidosPorRonda.map((_, i) => i).reverse()
          : grilla.partidosPorRonda.map((_, i) => i)
        ).map((indiceRonda) => {
          const partidos = grilla.partidosPorRonda[indiceRonda];
          return (
            <div key={`${keyPrefix}-${grilla.rondas[indiceRonda]}`} className="bracket-round">
              <div className="bracket-round-title">
                {nombreDeRondaTradicional(
                  grilla.rondas,
                  indiceRonda,
                  grilla.totalRondasReal,
                  partidos.length,
                  grilla.permiteFinal
                )}
              </div>

              <div className="bracket-round-matches">
                {partidos.map((match, indiceEnRonda) =>
                  renderPartido(match, {
                    keyPrefix,
                    round: grilla.rondas[indiceRonda],
                    matchNumber: match.match_number,
                    indiceEnRonda,
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // En eliminación doble nunca hay un bye real (generar_llave_doble
  // exige potencia de 2 exacta) -- un participantId null ahí siempre
  // es "todavía no cayó el rival de este lado", no un pase directo.
  const nombreDe = (participantId: string | null) =>
    participantId
      ? nombresPorParticipante[participantId] ?? "Jugador de RemorApp"
      : esEliminacionDoble
        ? "Esperando rival"
        : "BYE";

  const logoDe = (participantId: string | null) => {
    if (!participantId) return null;
    if (logosPorParticipante) return logosPorParticipante[participantId] ?? null;
    // 1v1: solo el estilo "esports" muestra el avatar -- "clasico" y
    // "starcraft_oficial" en 1v1 se quedan exactamente como estaban.
    if (estilo === "esports") return avatarsPorParticipante?.[participantId] ?? null;
    return null;
  };

  // Migración 182, a pedido del usuario: reemplaza el <Avatar> fijo de
  // cada slot por una de 4 opciones elegidas en Panel de control. Si la
  // opción elegida no tiene dato para este participante en particular
  // (sin país cargado, equipo sin banner) no se muestra nada en vez de
  // caer de vuelta al logo -- el organizador eligió explícitamente esa
  // insignia, no un reemplazo silencioso.
  const renderInsignia = (participantId: string | null) => {
    if (insignia === "ninguno") return null;

    if (insignia === "bandera") {
      const pais = participantId ? paisesPorParticipante?.[participantId] ?? null : null;
      const iso = pais ? BANDERA_ISO[pais] : null;
      if (!iso) return null;
      return <span className={`bracket-slot-bandera fi fi-${iso}`} title={pais ?? undefined} />;
    }

    if (insignia === "banner_clan") {
      const banner = participantId ? bannersPorParticipante?.[participantId] ?? null : null;
      if (!banner) return null;
      return <img src={banner} alt="" className="bracket-slot-banner" />;
    }

    return <Avatar url={logoDe(participantId)} nombre={nombreDe(participantId)} className="bracket-slot-logo" />;
  };

  const puedeReportar = (match: BracketMatchRow) => {
    if (!userId) return false;
    if (userId === organizadorId) return true;
    if (!permiteAutoreporte) return false;
    if (match.participant1_id && puedeReportarPorParticipante[match.participant1_id]) return true;
    if (match.participant2_id && puedeReportarPorParticipante[match.participant2_id]) return true;
    return false;
  };

  // Migración 188, a pedido del usuario: puntaje opcional (ej. "2-1")
  // junto con el ganador -- borrador local por partido, se manda tal
  // cual al RPC (que lo guarda solo si el partido efectivamente queda
  // "jugado" en esta llamada, ver reportar_resultado() en la base).
  const [scoreDraft, setScoreDraft] = useState<Record<string, { p1: string; p2: string }>>({});

  const handleReportar = async (matchId: string, ganadorId: string) => {
    setReportando(matchId);
    setErrores((prev) => ({ ...prev, [matchId]: "" }));

    const borrador = scoreDraft[matchId];
    const resultado1 = borrador?.p1.trim() ? Number(borrador.p1) : null;
    const resultado2 = borrador?.p2.trim() ? Number(borrador.p2) : null;

    const { error } = await supabase.rpc("reportar_resultado", {
      p_match_id: matchId,
      p_ganador_id: ganadorId,
      p_resultado_participant1: resultado1,
      p_resultado_participant2: resultado2,
    });

    setReportando(null);

    if (error) {
      setErrores((prev) => ({ ...prev, [matchId]: error.message }));
      return;
    }

    onCambio();
  };

  const renderPartido = (
    match: BracketMatchRow,
    refInfo?: { keyPrefix: string; round: number; matchNumber: number; indiceEnRonda?: number }
  ) => {
    const p1Gana = !!match.winner_id && match.winner_id === match.participant1_id;
    const p2Gana = !!match.winner_id && match.winner_id === match.participant2_id;
    const refKey = refInfo ? `${refInfo.keyPrefix}::${refInfo.round}::${refInfo.matchNumber}` : null;

    return (
      <div
        key={match.id}
        className="bracket-match"
        // Migración 187, a pedido del usuario: estructura "escalera" --
        // zigzag parejo/impar en vez de alinear todos los partidos de
        // la ronda en la misma fila (ver [data-estructura="escalera"]
        // en halcon.css). Acotado a 0/1 a propósito: un offset que
        // creciera sin techo con el índice se podía salir del alto fijo
        // de .bracket (overflow: hidden), este queda siempre chico.
        style={
          refInfo?.indiceEnRonda !== undefined
            ? ({ "--escalon-index": refInfo.indiceEnRonda % 2 } as CSSProperties)
            : undefined
        }
        ref={(el) => {
          if (!refKey) return;
          if (el) matchElRefs.current.set(refKey, el);
          else matchElRefs.current.delete(refKey);
        }}
      >
        {/* Migración 057: etiqueta informativa -- no hay puntaje por
            mapa dentro de la llave, solo le indica a los jugadores
            cómo tienen que jugar esta partida puntual (usada por la
            final de los playoffs de First Stand). */}
        {match.formato_partido === "bo5" && <span className="veto-tag bracket-bo5-tag">Bo5</span>}
        <div className={`bracket-slot ${p1Gana ? "winner" : match.winner_id ? "loser" : ""}`}>
          {renderInsignia(match.participant1_id)}
          <span className="bracket-slot-nombre">{nombreDe(match.participant1_id)}</span>
          {match.resultado_participant1 !== null && (
            <span className="bracket-slot-score">{match.resultado_participant1}</span>
          )}
        </div>
        <div
          className={`bracket-slot ${
            p2Gana ? "winner" : match.winner_id && match.participant2_id ? "loser" : ""
          }`}
        >
          {renderInsignia(match.participant2_id)}
          <span className="bracket-slot-nombre">{nombreDe(match.participant2_id)}</span>
          {match.resultado_participant2 !== null && (
            <span className="bracket-slot-score">{match.resultado_participant2}</span>
          )}
        </div>

        {match.status === "en_disputa" && (
          <p className="bracket-disputa">
            Resultado en disputa, un administrador debe resolverlo.
          </p>
        )}

        {/* Migración 090: un cruce del bracket con Clan War vinculada
            (torneo formato "wtl") no se reporta con el click de
            siempre -- el resultado sale de cerrar_clan_war() cuando
            los dos capitanes cierran la guerra. Mismo criterio que
            GroupStage.tsx para los partidos de liga.
            Migración 174, a pedido del usuario: antes esto solo se
            mostraba mientras el partido seguía "pendiente", y solo con
            un link propio para quien jugaba -- una vez jugado, no
            había forma de ver qué jugadores eligió cada clan ni quién
            ganó/perdió cada partida individual. Ahora el link a
            /clan-war/:id (vista pública del lineup, ya existía para
            otros usos) queda disponible para cualquiera, en cualquier
            estado del partido. */}
        {match.participant1_id && match.participant2_id && match.clan_war_id && (
          <div className="bracket-report">
            {match.status === "pendiente" &&
            miEquipoTag &&
            (match.participant1_id === miParticipantId || match.participant2_id === miParticipantId) ? (
              <Link className="btn btn-ghost" to={`/equipos/${miEquipoTag}?panel=eventos`}>
                Ir a la Clan War
              </Link>
            ) : (
              <Link className="btn btn-ghost" to={`/clan-war/${match.clan_war_id}`}>
                {match.status === "pendiente" ? "Ver lineup" : "Ver lineup y resultado"}
              </Link>
            )}
          </div>
        )}

        {match.status === "pendiente" &&
          match.participant1_id &&
          match.participant2_id &&
          !match.clan_war_id &&
          puedeReportar(match) && (
            <div className="bracket-report">
              {/* Migración 188, a pedido del usuario: puntaje opcional
                  (mapas/rondas ganadas) -- se puede dejar vacío, el
                  resultado se reporta igual solo con el botón de abajo. */}
              <div className="bracket-report-score">
                <input
                  type="number"
                  min={0}
                  className="form-input bracket-report-score-input"
                  placeholder="0"
                  aria-label={`Puntaje de ${nombreDe(match.participant1_id)}`}
                  value={scoreDraft[match.id]?.p1 ?? ""}
                  onChange={(e) =>
                    setScoreDraft((prev) => ({
                      ...prev,
                      [match.id]: { p1: e.target.value, p2: prev[match.id]?.p2 ?? "" },
                    }))
                  }
                />
                <span className="bracket-report-score-vs">-</span>
                <input
                  type="number"
                  min={0}
                  className="form-input bracket-report-score-input"
                  placeholder="0"
                  aria-label={`Puntaje de ${nombreDe(match.participant2_id)}`}
                  value={scoreDraft[match.id]?.p2 ?? ""}
                  onChange={(e) =>
                    setScoreDraft((prev) => ({
                      ...prev,
                      [match.id]: { p1: prev[match.id]?.p1 ?? "", p2: e.target.value },
                    }))
                  }
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={reportando === match.id}
                onClick={() => handleReportar(match.id, match.participant1_id as string)}
              >
                Ganó {nombreDe(match.participant1_id)}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={reportando === match.id}
                onClick={() => handleReportar(match.id, match.participant2_id as string)}
              >
                Ganó {nombreDe(match.participant2_id)}
              </button>
            </div>
          )}

        {errores[match.id] && <div className="form-error">{errores[match.id]}</div>}
      </div>
    );
  };

  // ---------- Estructura "embudo al centro" (migración 177) ----------
  // Parte el cuadro en dos mitades que convergen hacia el medio, con
  // la final centrada -- el look clásico de transmisiones grandes.
  //
  // Corrección: la primera versión espejaba la mitad derecha entera
  // con CSS (transform: scaleX(-1)) -- pero el <svg> de las líneas
  // quedaba DENTRO de ese mismo espejo, así que el trazo (calculado
  // con la posición ya espejada de cada partido) se espejaba una
  // SEGUNDA vez al pintarse y quedaba completamente desalineado.
  // Ahora la mitad derecha no usa ningún transform: renderGrilla
  // simplemente dibuja sus rondas en orden visual inverso cuando
  // keyPrefix es "embudo-der" (última ronda primero, Ronda 1 al
  // final) y la medición de líneas usa la fórmula en espejo para ese
  // mismo keyPrefix (ver el useLayoutEffect más arriba) -- mismos
  // datos, mismo DOM sin transformar, solo el orden de pintado cambia.
  const partidosParaEmbudo = (partidos: BracketMatchRow[]) => {
    const porRonda = new Map<number, BracketMatchRow[]>();
    partidos.forEach((m) => {
      const lista = porRonda.get(m.round) ?? [];
      lista.push(m);
      porRonda.set(m.round, lista);
    });

    const izquierda: BracketMatchRow[] = [];
    const derecha: BracketMatchRow[] = [];
    let final: BracketMatchRow | null = null;

    [...porRonda.entries()]
      .sort(([a], [b]) => a - b)
      .forEach(([, lista]) => {
        const ordenados = [...lista].sort((a, b) => a.match_number - b.match_number);
        if (ordenados.length <= 1) {
          final = ordenados[0] ?? null;
          return;
        }
        const mitad = ordenados.length / 2;
        izquierda.push(...ordenados.slice(0, mitad));
        derecha.push(...ordenados.slice(mitad));
      });

    return { izquierda, derecha, final };
  };

  // Franja superior con el nombre del torneo (solo estilo "esports") --
  // migración 181, a pedido del usuario: "modelo" elegible
  // (data-estilo-titulo) + color de texto personalizado.
  const renderBanner = () =>
    estilo === "esports" && (
      <div
        className="bracket-esports-banner"
        data-estilo-titulo={estiloTitulo}
        data-titulo-animado={tituloAnimado}
        style={
          {
            ...(colorTextoTitulo ? { "--titulo-texto-color": colorTextoTitulo } : {}),
            ...(fuenteTexto ? { "--fuente-texto-personalizada": fuenteTexto } : {}),
            ...(tamanoFuenteTitulo ? { "--titulo-tamano-fuente": `${tamanoFuenteTitulo}px` } : {}),
          } as CSSProperties
        }
      >
        {nombreTorneo}
      </div>
    );

  const renderEmbudo = () => {
    const partidosSinTercerLugar = matches.filter((m) => !m.es_tercer_lugar);
    const { izquierda, derecha, final } = partidosParaEmbudo(partidosSinTercerLugar);

    // Con solo 2 participantes no hay "mitades" que converjan -- una
    // sola partida que ya es la final. Cae al armado de siempre.
    if (izquierda.length === 0 || derecha.length === 0) {
      return renderGrilla(armarGrilla(partidosSinTercerLugar, !!nombresRondaPersonalizados), "unica");
    }

    // Dentro de cada mitad, la última ronda (1 solo partido) es en
    // realidad una semifinal del torneo completo, no "la Final" -- la
    // Final real es el partido centrado acá abajo (permiteFinal=false
    // en armarGrilla de cada mitad evita el "Final" automático ahí).
    const lineasEmbudo = conectoresPorGrilla["embudo-wrap"] ?? [];
    const tamanoEmbudo = tamanoPorGrilla["embudo-wrap"];

    return (
      <div
        className="bracket-embudo-wrap"
        style={
          {
            ...(colorLinea ? { "--linea-color": colorLinea } : {}),
            ...(colorTexto ? { "--texto-bracket-color": colorTexto } : {}),
            ...(fuenteTexto ? { "--fuente-texto-personalizada": fuenteTexto } : {}),
          } as CSSProperties
        }
        ref={(el) => {
          if (el) grillaElRefs.current.set("embudo-wrap", el);
          else grillaElRefs.current.delete("embudo-wrap");
        }}
      >
        {/* Las líneas que conectan cada mitad con la Final (no las de
            DENTRO de cada mitad, esas ya las dibuja cada .bracket por
            su cuenta) -- medidas con .bracket-embudo-wrap como
            referencia, ver el useLayoutEffect más arriba. */}
        {muestraConectores && lineasEmbudo.length > 0 && tamanoEmbudo && (
          <svg
            className="bracket-conectores bracket-conectores-embudo"
            data-estilo-linea={estiloLinea}
            width={tamanoEmbudo.ancho}
            height={tamanoEmbudo.alto}
            style={colorLinea ? ({ "--linea-color": colorLinea } as CSSProperties) : undefined}
          >
            {lineasEmbudo.map((linea) => (
              <path key={linea.key} d={linea.d} />
            ))}
          </svg>
        )}

        {renderGrilla(armarGrilla(izquierda, false, false), "embudo-izq")}

        {final && (
          <div className="bracket-tercer-lugar bracket-embudo-final" data-estilo-bracket={estilo}>
            <div className="bracket-round-title">Final</div>
            {renderPartido(final, { keyPrefix: "embudo-final", round: 0, matchNumber: 1 })}
          </div>
        )}

        {renderGrilla(armarGrilla(derecha, false, false), "embudo-der")}
      </div>
    );
  };

  // Migración 189, a pedido del usuario: 16+ participantes pisa la
  // Estructura elegida -- Grupo A/Grupo B, cada uno su propia llave de
  // 3 rondas, más una Vista panorámica. El botón de pantalla completa
  // ya existente (TournamentDetailPage.tsx) aplica a lo que esté
  // elegido acá, sin ningún mecanismo nuevo.
  //
  // Corrección: Vista panorámica llamaba siempre a renderEmbudo(), que
  // fuerza el look de "Embudo al centro" (líneas convergiendo al
  // medio) sin importar qué Estructura hubiera elegido el organizador
  // -- a pedido del usuario, "la Estructura elegida no se aplica". Esa
  // convergencia solo tiene sentido si realmente se eligió "Embudo al
  // centro"; para Clásico/Vertical/Escalera, Vista panorámica ahora
  // muestra los dos grupos lado a lado, cada uno con su propia
  // Estructura respetada (mismo renderGrilla que Grupo A/Grupo B solos).
  if (esLlaveGrande) {
    const partidosSinTercerLugar = matches.filter((m) => !m.es_tercer_lugar);
    const { izquierda, derecha, final } = partidosParaEmbudo(partidosSinTercerLugar);

    return (
      <>
        {renderBanner()}

        <div className="bracket-grupos-tabs">
          <button
            type="button"
            className={`bracket-grupos-tab ${vistaGrupo === "a" ? "selected" : ""}`}
            onClick={() => setVistaGrupo("a")}
          >
            Grupo A
          </button>
          <button
            type="button"
            className={`bracket-grupos-tab ${vistaGrupo === "b" ? "selected" : ""}`}
            onClick={() => setVistaGrupo("b")}
          >
            Grupo B
          </button>
          <button
            type="button"
            className={`bracket-grupos-tab ${vistaGrupo === "panoramica" ? "selected" : ""}`}
            onClick={() => setVistaGrupo("panoramica")}
          >
            Vista panorámica
          </button>
        </div>

        {vistaGrupo === "a" && renderGrilla(armarGrilla(izquierda, !!nombresRondaPersonalizados, true), "grupo-a")}
        {vistaGrupo === "b" && renderGrilla(armarGrilla(derecha, !!nombresRondaPersonalizados, true), "grupo-b")}
        {vistaGrupo === "panoramica" &&
          (esEmbudo ? (
            <>
              {renderEmbudo()}
              {partidoTercerLugar && (
                <div className="bracket-tercer-lugar" data-estilo-bracket={estilo}>
                  <div className="bracket-round-title">Partido por el 3er lugar</div>
                  {renderPartido(partidoTercerLugar)}
                </div>
              )}
            </>
          ) : (
            <div className="bracket-panoramica-grupos">
              <div className="bracket-panoramica-grupo">
                <div className="bracket-round-title bracket-seccion-titulo">Grupo A</div>
                {renderGrilla(armarGrilla(izquierda, !!nombresRondaPersonalizados, true), "grupo-a-pan")}
              </div>
              <div className="bracket-panoramica-grupo">
                <div className="bracket-round-title bracket-seccion-titulo">Grupo B</div>
                {renderGrilla(armarGrilla(derecha, !!nombresRondaPersonalizados, true), "grupo-b-pan")}
              </div>
              {final && (
                <div className="bracket-tercer-lugar" data-estilo-bracket={estilo}>
                  <div className="bracket-round-title">Final</div>
                  {renderPartido(final, { keyPrefix: "grupo-final-pan", round: 0, matchNumber: 1 })}
                </div>
              )}
              {partidoTercerLugar && (
                <div className="bracket-tercer-lugar" data-estilo-bracket={estilo}>
                  <div className="bracket-round-title">Partido por el 3er lugar</div>
                  {renderPartido(partidoTercerLugar)}
                </div>
              )}
            </div>
          ))}
      </>
    );
  }

  if (esEmbudo && !esEliminacionDoble) {
    return (
      <>
        {renderBanner()}
        {renderEmbudo()}
        {partidoTercerLugar && (
          <div className="bracket-tercer-lugar" data-estilo-bracket={estilo}>
            <div className="bracket-round-title">Partido por el 3er lugar</div>
            {renderPartido(partidoTercerLugar)}
          </div>
        )}
      </>
    );
  }

  if (esEliminacionDoble) {
    const partidosGanadores = matches.filter((m) => m.bracket_tipo === "ganadores");
    const partidosPerdedores = matches.filter((m) => m.bracket_tipo === "perdedores");
    const partidoFinal = matches.find((m) => m.bracket_tipo === "final") ?? null;
    const partidoReset = matches.find((m) => m.bracket_tipo === "reset") ?? null;

    return (
      <>
        {renderBanner()}

        <div className="bracket-round-title bracket-seccion-titulo">Llave de ganadores</div>
        {renderGrilla(armarGrilla(partidosGanadores, !!nombresRondaPersonalizados, false), "ganadores")}

        {partidosPerdedores.length > 0 && (
          <>
            <div className="bracket-round-title bracket-seccion-titulo">Llave de perdedores</div>
            {renderGrilla(armarGrilla(partidosPerdedores, false, false), "perdedores")}
          </>
        )}

        {partidoFinal && (
          <div className="bracket-tercer-lugar" data-estilo-bracket={estilo}>
            <div className="bracket-round-title">Gran final</div>
            {renderPartido(partidoFinal)}
          </div>
        )}

        {partidoReset && (
          <div className="bracket-tercer-lugar" data-estilo-bracket={estilo}>
            <div className="bracket-round-title">Revancha (bracket reset)</div>
            {renderPartido(partidoReset)}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {renderBanner()}
      {renderGrilla(
        armarGrilla(
          matches.filter((m) => !m.es_tercer_lugar),
          !!nombresRondaPersonalizados
        ),
        "unica"
      )}

      {/* Migración 046: el partido por el tercer lugar se muestra
          aparte, claramente separado de la llave principal -- no
          mezclado con las rondas normales. */}
      {partidoTercerLugar && (
        <div className="bracket-tercer-lugar" data-estilo-bracket={estilo}>
          <div className="bracket-round-title">Partido por el 3er lugar</div>
          {renderPartido(partidoTercerLugar)}
        </div>
      )}
    </>
  );
}
