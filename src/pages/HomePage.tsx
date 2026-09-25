import Carrusel from "../components/Carrusel";
import ProximasClanWars from "../components/ProximasClanWars";
import NewsSection from "../components/NewsSection";
import InstalarRemorApp from "../components/InstalarRemorApp";

// Migración 110: Inicio pasa a ser un carrusel de 3 páginas
// deslizables (Noticias / Próximas Clan Wars / Instalar RemorApp), sin
// scroll vertical de página completa -- ver Carrusel.tsx. Se sacan de
// acá el título "Bienvenidos a RemorApp Gaming" + frase + botón "Mi
// perfil" (Hero.tsx, eliminado -- redundante con el header) y la barra
// de usuarios/torneos (StatsBar.tsx, eliminado -- se mudó al Panel de
// Administración, pestaña "Resumen").
export default function HomePage() {
  return (
    <div className="home-carrusel-page">
      <Carrusel
        paginas={[
          { key: "noticias", contenido: <NewsSection /> },
          { key: "clanwars", contenido: <ProximasClanWars /> },
          { key: "instalar", contenido: <InstalarRemorApp /> },
        ]}
      />
    </div>
  );
}
