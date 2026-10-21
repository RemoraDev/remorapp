import { useEffect, useRef } from "react";

const SELECTOR_FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface EntradaModal {
  onClose: () => void;
  getPanel: () => HTMLElement | null;
}

// Pila compartida entre TODAS las instancias del hook, no solo la
// propia -- varios modales de la app anidan otro adentro (ej.
// RecortadorImagenModal abierto desde dentro del Panel de control de
// Mi Clan/Comunidad). Con un listener de "keydown" por instancia,
// Escape disparaba los dos a la vez (stopPropagation no frena otros
// listeners en el MISMO target) y cerraba ambos de golpe. Acá un solo
// listener global siempre actúa sobre el tope de la pila (el modal
// abierto más reciente), para Escape y para el atrapado de Tab.
const pila: EntradaModal[] = [];
let listenerInstalado = false;

function manejarTeclado(event: KeyboardEvent) {
  const tope = pila[pila.length - 1];
  if (!tope) return;

  if (event.key === "Escape") {
    event.stopPropagation();
    tope.onClose();
    return;
  }

  if (event.key !== "Tab") return;
  const panel = tope.getPanel();
  if (!panel) return;

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
}

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

    if (!listenerInstalado) {
      document.addEventListener("keydown", manejarTeclado);
      listenerInstalado = true;
    }

    const previoEnfocado = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const primerFocusable = panel?.querySelector<HTMLElement>(SELECTOR_FOCUSABLE);
    (primerFocusable ?? panel)?.focus();

    const entrada: EntradaModal = { onClose, getPanel: () => panelRef.current };
    pila.push(entrada);

    return () => {
      const indice = pila.indexOf(entrada);
      if (indice !== -1) pila.splice(indice, 1);
      previoEnfocado?.focus?.();
    };
    // Nota: onClose a propósito fuera de las deps -- todos los
    // llamadores le pasan un setState estable (ej. "() =>
    // setPanelAbierto(false)"); si onClose entrara a las deps, un
    // simple re-render del padre (nueva identidad de la función
    // inline) reabriría este efecto y volvería a robarle el foco al
    // contenido mientras el modal sigue abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo]);

  return panelRef;
}
