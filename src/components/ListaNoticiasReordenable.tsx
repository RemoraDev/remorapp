import { useState, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabaseClient";

interface NoticiaOrdenable {
  id: string;
}

interface Props<T extends NoticiaOrdenable> {
  noticias: T[];
  onReordenar: (nuevas: T[]) => void;
  renderFila: (noticia: T, manija: ReactNode) => ReactNode;
}

function FilaArrastrable<T extends NoticiaOrdenable>({
  noticia,
  renderFila,
}: {
  noticia: T;
  renderFila: Props<T>["renderFila"];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: noticia.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const manija = (
    <button
      type="button"
      className="noticia-drag-handle"
      aria-label="Arrastrar para reordenar"
      {...attributes}
      {...listeners}
    >
      <GripVertical size={16} />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style}>
      {renderFila(noticia, manija)}
    </div>
  );
}

// Migración 100: reordenar noticias arrastrando (dnd-kit/sortable, el
// mismo ya instalado para el bracket manual) -- solo para is_admin() o
// es_staff() (lo valida reordenar_noticias() del lado de la base; acá
// no hace falta repetir el chequeo porque este componente solo vive
// dentro de páginas que ya están restringidas a esos roles).
// Genérico sobre T para poder reusarlo tanto en AdminPage.tsx (fila
// completa, con autor/fecha/botón de eliminar) como en StaffPage.tsx
// (fila mínima, solo título) sin duplicar la mecánica de arrastre.
export default function ListaNoticiasReordenable<T extends NoticiaOrdenable>({
  noticias,
  onReordenar,
  renderFila,
}: Props<T>) {
  const [, setGuardando] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = noticias.findIndex((n) => n.id === active.id);
    const newIndex = noticias.findIndex((n) => n.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const nuevas = arrayMove(noticias, oldIndex, newIndex);
    // Optimista: se ve el nuevo orden al toque, sin esperar la
    // confirmación del servidor.
    onReordenar(nuevas);

    setGuardando(true);
    const { error } = await supabase.rpc("reordenar_noticias", { p_orden: nuevas.map((n) => n.id) });
    setGuardando(false);

    if (error) {
      toast.error(error.message);
      onReordenar(noticias);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={noticias.map((n) => n.id)} strategy={verticalListSortingStrategy}>
        {noticias.map((n) => (
          <FilaArrastrable key={n.id} noticia={n} renderFila={renderFila} />
        ))}
      </SortableContext>
    </DndContext>
  );
}
