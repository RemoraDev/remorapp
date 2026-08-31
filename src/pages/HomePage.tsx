import Hero from "../components/Hero";
import FeaturedTournament from "../components/FeaturedTournament";
import ActiveTournaments from "../components/ActiveTournaments";
import CommissionInfo from "../components/CommissionInfo";
import { torneoDestacado } from "../data/mockTournaments";

export default function HomePage() {
  return (
    <>
      <Hero />
      <FeaturedTournament torneo={torneoDestacado} />
      <ActiveTournaments />
      <CommissionInfo />
    </>
  );
}
