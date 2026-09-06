import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { formatFecha } from "../lib/formatters";
import type { ClanWarProxima } from "../types/clanWars";

interface TorneoRespaldo {
  id: string;
  nombre: string;
  fecha_inicio: string;
}

const formatoHora = new Intl.DateTimeFormat("es-CL", { timeStyle: "short" });

function esMismoDiaLocal(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Se actualiza sola cada minuto -- alcanza para un contador en "Xh
// Ymin" (no hace falta granularidad de segundos), sin depender de
// tiempo real por websockets, tal como se pidió.
function useAhora(intervaloMs: number): Date {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return ahora;
}

function formatearCuentaRegresiva(objetivo: Date, ahora: Date): string {
  const diffMs = objetivo.getTime() - ahora.getTime();
  if (diffMs <= 0) return "En curso";
  const totalMin = Math.floor(diffMs / 60000);
  const horas = Math.floor(totalMin / 60);
  const minutos = totalMin % 60;
  return horas > 0 ? `Comienza en ${horas}h ${minutos}min` : `Comienza en ${minutos}min`;
}

function LogoEquipo({ nombre, tag, logoUrl }: { nombre: string; tag: string; logoUrl: string | null }) {
  return logoUrl ? (
    <img src={logoUrl} alt={nombre} className="clan-war-card-logo" />
  ) : (
    <span className="clan-war-card-logo clan-war-card-logo-placeholder">{tag.charAt(0)}</span>
  );
}

// No es un <Link>: una Clan War no tiene una página de detalle
// pública (el detalle real, con lineup y resultado, es privado del
// equipo -- ver clan_wars_select_propio) -- esta tarjeta es solo un
// aviso de horario, no un acceso a más contenido. Mismo lenguaje
// visual que el "Torneo destacado" (.featured*), adaptado a tarjeta de
// grilla en vez de héroe único.
function TarjetaClanWar({ cw, ahora }: { cw: ClanWarProxima; ahora: Date }) {
  const categoria = [cw.liga_nombre, cw.division_nombre].filter(Boolean).join(" · ");
  return (
    <div className="clan-war-card">
      <div className="clan-war-card-glow" />
      <div className="clan-war-card-body">
        {categoria && <span className="clan-war-card-badge">{categoria}</span>}
        <div className="clan-war-card-equipos">
          <div className="clan-war-card-equipo">
            <LogoEquipo nombre={cw.challenger_nombre} tag={cw.challenger_tag} logoUrl={cw.challenger_logo_url} />
            <span className="clan-war-card-tag">{cw.challenger_tag}</span>
          </div>
          <span className="clan-war-card-vs">VS</span>
          <div className="clan-war-card-equipo">
            <LogoEquipo nombre={cw.challenged_nombre} tag={cw.challenged_tag} logoUrl={cw.challenged_logo_url} />
            <span className="clan-war-card-tag">{cw.challenged_tag}</span>
          </div>
        </div>
        <div className="clan-war-card-footer">
          <span className="clan-war-card-hora">{formatoHora.format(new Date(cw.fecha_hora_cet))}</span>
          <span className="clan-war-card-cuenta-regresiva">
            {formatearCuentaRegresiva(new Date(cw.fecha_hora_cet), ahora)}
          </span>
        </div>
      </div>
    </div>
  );
}

// Clan Wars programadas para hoy y mañana, en la hora local de quien
// mira -- fecha_hora_cet ya viene como timestamptz (un instante
// absoluto), así que new Date(...) + Intl.DateTimeFormat sin
// "timeZone" explícito alcanza para mostrarla convertida sola. Si no
// hay ninguna en esas dos fechas, se muestran los próximos torneos por
// fecha de inicio como respaldo.
export default function ProximasClanWars() {
  const [clanWars, setClanWars] = useState<ClanWarProxima[] | null>(null);
  const [torneosRespaldo, setTorneosRespaldo] = useState<TorneoRespaldo[]>([]);

  useEffect(() => {
    supabase.rpc("clan_wars_proximas").then(({ data, error }) => {
      if (error) {
        console.error("Error cargando las próximas Clan Wars:", error);
        setClanWars([]);
        return;
      }
      setClanWars((data ?? []) as ClanWarProxima[]);
    });
  }, []);

  // Se recalcula sola cada minuto -- así el contador de cada Clan War
  // avanza en vivo sin recargar la página, y "Hoy"/"Mañana" también se
  // reclasifica solo si alguien deja la pestaña abierta hasta pasar la
  // medianoche.
  const ahora = useAhora(60000);
  const manana = new Date(ahora);
  manana.setDate(ahora.getDate() + 1);

  const deHoy = (clanWars ?? []).filter((cw) => esMismoDiaLocal(new Date(cw.fecha_hora_cet), ahora));
  const deManana = (clanWars ?? []).filter((cw) => esMismoDiaLocal(new Date(cw.fecha_hora_cet), manana));
  const sinNadaProgramado = clanWars !== null && deHoy.length === 0 && deManana.length === 0;

  useEffect(() => {
    if (!sinNadaProgramado) return;
    supabase
      .from("tournaments")
      .select("id, nombre, fecha_inicio")
      .eq("estado", "abierto")
      .order("fecha_inicio", { ascending: true })
      .limit(3)
      .then(({ data, error }) => {
        if (error) {
          console.error("Error cargando torneos de respaldo:", error);
          return;
        }
        setTorneosRespaldo(data ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinNadaProgramado]);

  if (clanWars === null) return null;

  return (
    <div className="proximas-clan-wars">
      <div className="section-head">
        <h2 className="detail-subtitle">Clan Wars próximas</h2>
        <Link to="/calendario" className="btn btn-ghost">
          Ver horario completo
        </Link>
      </div>

      {!sinNadaProgramado ? (
        <>
          {deHoy.length > 0 && (
            <div className="proxima-clan-war-grupo">
              <h3 className="proxima-clan-war-grupo-titulo">Hoy</h3>
              <div className="clan-war-cards-grid">
                {deHoy.map((cw) => (
                  <TarjetaClanWar key={cw.id} cw={cw} ahora={ahora} />
                ))}
              </div>
            </div>
          )}
          {deManana.length > 0 && (
            <div className="proxima-clan-war-grupo">
              <h3 className="proxima-clan-war-grupo-titulo">Mañana</h3>
              <div className="clan-war-cards-grid">
                {deManana.map((cw) => (
                  <TarjetaClanWar key={cw.id} cw={cw} ahora={ahora} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : torneosRespaldo.length === 0 ? (
        <p className="detail-empty">No hay Clan Wars ni torneos próximos por el momento.</p>
      ) : (
        <div className="proxima-clan-war-grupo">
          <h3 className="proxima-clan-war-grupo-titulo">Sin Clan Wars programadas -- próximos torneos</h3>
          {torneosRespaldo.map((t) => (
            <Link key={t.id} to={`/tournaments/${t.id}`} className="proxima-clan-war-item">
              <span className="proxima-clan-war-hora">{formatFecha(t.fecha_inicio)}</span>
              <span className="proxima-clan-war-equipos">{t.nombre}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
