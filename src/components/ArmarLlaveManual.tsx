import { useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Avatar from "./Avatar";
import type { AvatarForma } from "../types/profile";

export interface ParticipanteParaLlave {
  id: string;
  nombre: string;
  avatarUrl: string | null;
  avatarForma?: AvatarForma;
}

interface Props {
  participantes: ParticipanteParaLlave[];
  guardando: boolean;
  error: string | null;
  onConfirmar: (orden: (string | null)[]) => void;
  onCancelar: () => void;
}

// Migración 097: misma fórmula de "próxima potencia de 2" que usa
// generar_llave() en la base -- acá solo para saber cuántos
// casilleros dibujar, la validación real de nuevo vive en
// generar_llave_manual().
function proximaPotenciaDeDos(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Contenido puramente visual (avatar + nombre) -- lo usan tanto la
// tarjeta arrastrable real como la vista previa flotante del
// DragOverlay, que NO debe registrarse a su vez como otro draggable.
function ContenidoTarjeta({ participante }: { participante: ParticipanteParaLlave }) {
  return (
    <>
      <Avatar
        url={participante.avatarUrl}
        nombre={participante.nombre}
        className="llave-manual-tarjeta-avatar"
        forma={participante.avatarForma}
      />
      <span className="llave-manual-tarjeta-nombre">{participante.nombre}</span>
    </>
  );
}

function TarjetaArrastrable({ dragId, participante }: { dragId: string; participante: ParticipanteParaLlave }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: dragId });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`llave-manual-tarjeta ${isDragging ? "llave-manual-tarjeta-arrastrando" : ""}`}
    >
      <ContenidoTarjeta participante={participante} />
    </div>
  );
}

function Casillero({
  indice,
  participante,
}: {
  indice: number;
  participante: ParticipanteParaLlave | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${indice}` });

  return (
    <div
      ref={setNodeRef}
      className={`llave-manual-casillero ${isOver ? "llave-manual-casillero-sobre" : ""} ${
        participante ? "" : "llave-manual-casillero-vacio"
      }`}
    >
      {participante ? (
        <TarjetaArrastrable dragId={`slot:${indice}`} participante={participante} />
      ) : (
        <span className="llave-manual-casillero-texto">Bye (casillero vacío)</span>
      )}
    </div>
  );
}

function ZonaSinAsignar({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool" });

  return (
    <div ref={setNodeRef} className={`llave-manual-pool ${isOver ? "llave-manual-pool-sobre" : ""}`}>
      {children}
    </div>
  );
}

// Arma el bracket a mano, arrastrando cada participante inscrito a su
// casillero de la primera ronda -- alternativa al sorteo automático de
// generar_llave(). El estado se guarda como un array de casilleros
// (uno por posición del bracket, con null en los vacíos); recién al
// confirmar se manda ese orden a generar_llave_manual(), que valida y
// arma bracket_matches con el mismo esquema exacto que el sorteo.
export default function ArmarLlaveManual({ participantes, guardando, error, onConfirmar, onCancelar }: Props) {
  const totalCasilleros = proximaPotenciaDeDos(participantes.length);
  const [casilleros, setCasilleros] = useState<(string | null)[]>(() => Array(totalCasilleros).fill(null));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  const porId = new Map(participantes.map((p) => [p.id, p]));
  const asignados = new Set(casilleros.filter((c): c is string => c !== null));
  const pendientes = participantes.filter((p) => !asignados.has(p.id));
  const numPartidos = totalCasilleros / 2;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  const participanteDeDragId = (id: string | null): ParticipanteParaLlave | null => {
    if (!id) return null;
    if (id.startsWith("pool:")) return porId.get(id.slice(5)) ?? null;
    if (id.startsWith("slot:")) {
      const indice = Number(id.slice(5));
      const pid = casilleros[indice];
      return pid ? porId.get(pid) ?? null : null;
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    setCasilleros((prev) => {
      const nuevo = [...prev];

      if (activeIdStr.startsWith("pool:")) {
        const participantId = activeIdStr.slice(5);
        if (overIdStr.startsWith("slot:")) {
          const destino = Number(overIdStr.slice(5));
          nuevo[destino] = participantId;
        }
        return nuevo;
      }

      if (activeIdStr.startsWith("slot:")) {
        const origen = Number(activeIdStr.slice(5));
        if (overIdStr === "pool") {
          nuevo[origen] = null;
          return nuevo;
        }
        if (overIdStr.startsWith("slot:")) {
          const destino = Number(overIdStr.slice(5));
          if (origen === destino) return prev;
          const temp = nuevo[destino];
          nuevo[destino] = nuevo[origen];
          nuevo[origen] = temp;
        }
      }

      return nuevo;
    });
  };

  const handleConfirmar = () => {
    setErrorLocal(null);

    if (pendientes.length > 0) {
      setErrorLocal(
        `Todavía te falta asignar ${pendientes.length} participante(s) a un casillero.`
      );
      return;
    }

    for (let i = 0; i < numPartidos; i++) {
      if (casilleros[i * 2] === null && casilleros[i * 2 + 1] === null) {
        setErrorLocal(
          `La partida ${i + 1} quedó con los dos casilleros vacíos -- reacomoda los byes, cada uno necesita un participante.`
        );
        return;
      }
    }

    onConfirmar(casilleros);
  };

  const participanteArrastrado = participanteDeDragId(activeId);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="llave-manual-layout">
        <div className="llave-manual-columna">
          <h3 className="detail-subtitle">Sin asignar ({pendientes.length})</h3>
          <ZonaSinAsignar>
            {pendientes.length === 0 ? (
              <p className="detail-empty">Todos los participantes ya tienen un casillero.</p>
            ) : (
              pendientes.map((p) => (
                <TarjetaArrastrable key={p.id} dragId={`pool:${p.id}`} participante={p} />
              ))
            )}
          </ZonaSinAsignar>
        </div>

        <div className="llave-manual-columna">
          <h3 className="detail-subtitle">Casilleros del bracket</h3>
          <div className="llave-manual-partidos">
            {Array.from({ length: numPartidos }, (_, i) => (
              <div key={i} className="llave-manual-partido">
                <span className="llave-manual-partido-numero">Partida {i + 1}</span>
                <Casillero indice={i * 2} participante={porId.get(casilleros[i * 2] ?? "") ?? null} />
                <span className="llave-manual-partido-vs">vs</span>
                <Casillero indice={i * 2 + 1} participante={porId.get(casilleros[i * 2 + 1] ?? "") ?? null} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>
        {participanteArrastrado ? (
          <div className="llave-manual-tarjeta llave-manual-tarjeta-overlay">
            <ContenidoTarjeta participante={participanteArrastrado} />
          </div>
        ) : null}
      </DragOverlay>

      {errorLocal && <div className="form-error">{errorLocal}</div>}
      {error && <div className="form-error">{error}</div>}

      <div className="llave-manual-acciones">
        <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" onClick={handleConfirmar} disabled={guardando}>
          {guardando ? "Generando..." : "Confirmar bracket"}
        </button>
      </div>
    </DndContext>
  );
}
