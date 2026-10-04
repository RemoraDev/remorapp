import { useLocation, useNavigate } from "react-router-dom";
import type { Location } from "react-router-dom";

// Migración 151: patrón compartido de "página como ventana superpuesta"
// (Mi perfil, Panel Staff, Administración) -- centraliza acá la lógica
// que antes vivía repetida/parcial en ProfilePage.tsx: leer el
// backgroundLocation del state de la navegación, decidir si la página
// actual se está mostrando como overlay, y volver a la página de fondo
// al cerrar. abrirOverlay() además se usa desde ADENTRO de un overlay
// ya abierto (ej.: "Panel Staff" clickeado desde el menú de Mi perfil)
// -- en ese caso propaga el backgroundLocation ORIGINAL, no el de Mi
// perfil, para que cerrar el nuevo overlay vuelva a la página de
// verdad en la que estaba el usuario, no a un overlay intermedio.
export function useOverlayPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const backgroundLocation = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation;
  const esOverlay = Boolean(backgroundLocation);

  const abrirOverlay = (path: string) => {
    navigate(path, { state: { backgroundLocation: backgroundLocation ?? location } });
  };

  const cerrarOverlay = () => {
    if (backgroundLocation) {
      navigate(`${backgroundLocation.pathname}${backgroundLocation.search ?? ""}`, { replace: true });
    } else {
      navigate(-1);
    }
  };

  return { esOverlay, abrirOverlay, cerrarOverlay };
}
