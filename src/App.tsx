import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Header from "./components/Header";
import BottomNav from "./components/BottomNav";
import HomePage from "./pages/HomePage";
import TournamentsPage from "./pages/TournamentsPage";
import CreateTournamentPage from "./pages/CreateTournamentPage";
import TournamentDetailPage from "./pages/TournamentDetailPage";
import TournamentHistoryPage from "./pages/TournamentHistoryPage";
import HistoricalTournamentsPage from "./pages/HistoricalTournamentsPage";
import HallOfFamePage from "./pages/HallOfFamePage";
import PlayerDetailPage from "./pages/PlayerDetailPage";
import MyTournamentsPage from "./pages/MyTournamentsPage";
import ProfilePage from "./pages/ProfilePage";
import AdminPage from "./pages/AdminPage";
import TeamsPage from "./pages/TeamsPage";
import CreateTeamPage from "./pages/CreateTeamPage";
import TeamDetailPage from "./pages/TeamDetailPage";
import NewsPage from "./pages/NewsPage";
import ForumPage from "./pages/ForumPage";
import StorePage from "./pages/StorePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";

// Aparte de App para poder usar useAuth() (AuthProvider envuelve a
// este componente, no a App -- App es quien lo declara).
function AppContent() {
  const { profile } = useAuth();

  return (
    <div className="app-shell">
      <Header />
      {profile?.suspendido && (
        <div className="suspended-banner">
          Tu cuenta está suspendida. Algunas acciones (crear torneos, inscribirte) no están
          disponibles.
        </div>
      )}
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/tournaments/create" element={<CreateTournamentPage />} />
          <Route path="/tournaments/history" element={<TournamentHistoryPage />} />
          <Route path="/torneos-historicos" element={<HistoricalTournamentsPage />} />
          <Route path="/sala-de-la-fama" element={<HallOfFamePage />} />
          <Route path="/jugador/:nick/:uniqueId" element={<PlayerDetailPage />} />
          <Route path="/tournaments/inscritos" element={<MyTournamentsPage />} />
          <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/equipos" element={<TeamsPage />} />
          <Route path="/equipos/crear" element={<CreateTeamPage />} />
          <Route path="/equipos/:tag" element={<TeamDetailPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/foro" element={<ForumPage />} />
          <Route path="/store" element={<StorePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}
