import Hero from "../components/Hero";

// Inicio se achicó a propósito: solo el Hero (título, países, CTA y el
// panal decorativo). "Torneo destacado" y "Torneos activos" salieron de
// acá; el bloque de la comisión del 5% se movió a /torneos, arriba de
// la grilla (ver TournamentsPage.tsx).
export default function HomePage() {
  return <Hero />;
}
