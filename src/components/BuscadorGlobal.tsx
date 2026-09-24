import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { Trophy, Users, Search } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import Avatar from "./Avatar";

interface Props {
  abierto: boolean;
  onClose: () => void;
}

interface ResultadoTorneo {
  id: string;
  nombre: string;
  estado: string;
}

interface ResultadoEquipo {
  id: string;
  name: string;
  tag: string;
  logo_url: string | null;
}

interface ResultadoJugador {
  id: string;
  nick: string;
  unique_id: string;
  avatar_url: string | null;
}

// Migración 099: buscador global (Ctrl+K). Las tres consultas
// reutilizan EXACTAMENTE el mismo criterio que ya usan sus buscadores
// existentes en la app -- torneos públicos y no excluidos de búsqueda
// (mismo filtro que TournamentsPage.tsx), equipos públicos no
// disueltos por nombre o tag (mismo ilike que la búsqueda de clan
// rival de CreateTournamentPage.tsx), y jugadores por Nick#ID exacto
// (mismo patrón de split("#") + doble eq que TeamDetailPage.tsx) --
// con un agregado: si todavía no se escribió el "#", se permite un
// ilike parcial solo por nick, para no obligar a saber el ID exacto
// de memoria.
export default function BuscadorGlobal({ abierto, onClose }: Props) {
  const navigate = useNavigate();
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [torneos, setTorneos] = useState<ResultadoTorneo[]>([]);
  const [equipos, setEquipos] = useState<ResultadoEquipo[]>([]);
  const [jugadores, setJugadores] = useState<ResultadoJugador[]>([]);

  useEffect(() => {
    if (!abierto) {
      // Se limpia al cerrar, para no mostrar resultados viejos la
      // próxima vez que se abra con Ctrl+K.
      setBusqueda("");
      setTorneos([]);
      setEquipos([]);
      setJugadores([]);
    }
  }, [abierto]);

  useEffect(() => {
    const termino = busqueda.trim();
    if (termino.length < 2) {
      setTorneos([]);
      setEquipos([]);
      setJugadores([]);
      setBuscando(false);
      return;
    }

    setBuscando(true);
    const timeout = setTimeout(async () => {
      const partesNick = termino.split("#");
      const esNickId = partesNick.length === 2 && partesNick[0].trim() && partesNick[1].trim();

      const [torneosRes, equiposRes, jugadoresRes] = await Promise.all([
        supabase
          .from("tournaments")
          .select("id, nombre, estado")
          .eq("publico", true)
          .eq("excluido_de_busqueda", false)
          .ilike("nombre", `%${termino}%`)
          .order("fecha_inicio", { ascending: false })
          .limit(5),
        supabase
          .from("teams")
          .select("id, name, tag, logo_url")
          .eq("is_public", true)
          .eq("disuelto", false)
          .or(`name.ilike.%${termino}%,tag.ilike.%${termino}%`)
          .order("name")
          .limit(5),
        esNickId
          ? supabase
              .from("profiles")
              .select("id, nick, unique_id, avatar_url")
              .eq("nick", partesNick[0].trim())
              .eq("unique_id", partesNick[1].trim())
              .limit(1)
          : supabase
              .from("profiles")
              .select("id, nick, unique_id, avatar_url")
              .eq("suspendido", false)
              .not("nick", "is", null)
              .ilike("nick", `%${termino}%`)
              .order("nick")
              .limit(5),
      ]);

      setTorneos((torneosRes.data ?? []) as ResultadoTorneo[]);
      setEquipos((equiposRes.data ?? []) as ResultadoEquipo[]);
      setJugadores((jugadoresRes.data ?? []) as ResultadoJugador[]);
      setBuscando(false);
    }, 300);

    return () => clearTimeout(timeout);
  }, [busqueda]);

  const irA = (ruta: string) => {
    onClose();
    navigate(ruta);
  };

  const sinResultados =
    busqueda.trim().length >= 2 && !buscando && torneos.length === 0 && equipos.length === 0 && jugadores.length === 0;

  return (
    <Command.Dialog
      open={abierto}
      onOpenChange={(open) => !open && onClose()}
      label="Buscador global"
      shouldFilter={false}
      overlayClassName="cmdk-overlay"
      contentClassName="cmdk-dialog"
    >
      <div className="cmdk-input-wrap">
        <Search size={16} className="cmdk-input-icon" />
        <Command.Input
          value={busqueda}
          onValueChange={setBusqueda}
          placeholder="Buscar torneos, equipos o jugadores (Nick#ID)..."
          autoFocus
        />
      </div>

      <Command.List>
        {busqueda.trim().length < 2 && (
          <p className="cmdk-hint">Escribe al menos 2 caracteres para buscar.</p>
        )}

        {sinResultados && <Command.Empty>No encontré nada con ese término.</Command.Empty>}

        {torneos.length > 0 && (
          <Command.Group heading="Torneos">
            {torneos.map((t) => (
              <Command.Item key={t.id} value={`torneo-${t.id}`} onSelect={() => irA(`/tournaments/${t.id}`)}>
                <Trophy size={16} className="cmdk-item-icon" />
                <span>{t.nombre}</span>
                <span className="cmdk-item-meta">{t.estado}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {equipos.length > 0 && (
          <Command.Group heading="Equipos">
            {equipos.map((e) => (
              <Command.Item key={e.id} value={`equipo-${e.id}`} onSelect={() => irA(`/equipos/${e.tag}`)}>
                {e.logo_url ? (
                  <img src={e.logo_url} alt="" className="cmdk-item-avatar" />
                ) : (
                  <Users size={16} className="cmdk-item-icon" />
                )}
                <span>{e.name}</span>
                <span className="cmdk-item-meta">{e.tag}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {jugadores.length > 0 && (
          <Command.Group heading="Jugadores">
            {jugadores.map((j) => (
              <Command.Item
                key={j.id}
                value={`jugador-${j.id}`}
                onSelect={() => irA(`/jugador/${j.nick}/${j.unique_id}`)}
              >
                <Avatar url={j.avatar_url} nombre={j.nick} className="cmdk-item-avatar" />
                <span>{j.nick}</span>
                <span className="cmdk-item-meta">#{j.unique_id}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>

      <div className="cmdk-footer">
        Nick#ID exacto para un jugador puntual, o solo el nick para buscar por coincidencia.
      </div>
    </Command.Dialog>
  );
}
