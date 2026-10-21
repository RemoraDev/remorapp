import { useEffect, useRef } from "react";

const SELECTOR_FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Corrección QA/UX: de los ~12 modales (.modal-backdrop/.modal-panel y
// variantes) que tiene la app, solo uno cerraba con Escape y ninguno
// atrapaba el foco -- el Tab se escapaba al contenido de atrás. Este
// hook se engancha al nodo del panel (no al backdrop) y: cierra con
// Escape, atrapa Tab/Shift+Tab dentro del panel, y devuelve el foco a
// lo que estaba enfocado antes de abrir el modal al cerrarlo.
export default function useModalEscapeYFoco<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  activo: boolean
) {
  const panelRef = useRef<T>(null);

  useEffect(() => {
    if (!activo) return;

    const previoEnfocado = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const primerFocusable = panel?.querySelector<HTMLElement>(SELECTOR_FOCUSABLE);
    (primerFocusable ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(SELECTOR_FOCUSABLE));
      if (focusables.length === 0) return;
      const primero = focusables[0];
      const ultimo = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === primero) {
        event.preventDefault();
        ultimo.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primero.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previoEnfocado?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo]);

  return panelRef;
}
