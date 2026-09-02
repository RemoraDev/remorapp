import Hero from "../components/Hero";
import StatsBar from "../components/StatsBar";
import NewsSection from "../components/NewsSection";

// Inicio se achicó a propósito: solo el Hero (título, países, CTA y el
// panal decorativo). "Torneo destacado" y "Torneos activos" salieron de
// acá; el bloque de la comisión del 5% se movió a /torneos, arriba de
// la grilla (ver TournamentsPage.tsx). La barra de estadísticas es la
// única incorporación desde entonces -- tres conteos simples, sin
// ningún sistema de presencia en tiempo real. Noticias se sumó acá
// debajo (salió de la barra inferior, ya no tiene ícono propio).
export default function HomePage() {
  return (
    <>
      <Hero />
      <StatsBar />
      <NewsSection />
    </>
  );
}
