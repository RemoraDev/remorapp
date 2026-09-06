import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Header from "./components/Header";
import BottomNav from "./components/BottomNav";
import OverlayClanWarPage from "./pages/OverlayClanWarPage";
import OverlayTorneoPage from "./pages/OverlayTorneoPage";
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
import PruebasLineupObservarPage from "./pages/PruebasLineupObservarPage";
import TeamsPage from "./pages/TeamsPage";
import CreateTeamPage from "./pages/CreateTeamPage";
import TeamDetailPage from "./pages/TeamDetailPage";
import NewsPage from "./pages/NewsPage";
import VoicePage from "./pages/VoicePage";
import AyudaPage from "./pages/AyudaPage";
import RankingPage from "./pages/RankingPage";
import ClanWarsSchedulePage from "./pages/ClanWarsSchedulePage";
import ClanWarLineupPublicoPage from "./pages/ClanWarLineupPublicoPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";

// Aparte de App para poder usar useAuth() (AuthProvider envuelve a
// este componente, no a App -- App es quien lo declara).
function AppContent() {
  const { profile } = useAuth();
  const location = useLocation();
  // Overlay para OBS (migración 044): páginas públicas, sin login, sin
  // el header ni la barra de navegación de la app -- solo el
  // contenido del overlay, para que se puedan pegar como "Browser
  // Source" en OBS sin que aparezca nada de la interfaz normal.
  const esOverlay = location.pathname.startsWith("/overlay/");

  if (esOverlay) {
    return (
      <Routes>
        <Route path="/overlay/cw/:id" element={<OverlayClanWarPage />} />
        <Route path="/overlay/torneo/:id" element={<OverlayTorneoPage />} />
      </Routes>
    );
  }

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
          <Route path="/pruebas/lineup/:clanWarId" element={<PruebasLineupObservarPage />} />
          <Route path="/equipos" element={<TeamsPage />} />
          <Route path="/equipos/crear" element={<CreateTeamPage />} />
          <Route path="/equipos/:tag" element={<TeamDetailPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/voice" element={<VoicePage />} />
          <Route path="/ayuda" element={<AyudaPage />} />
          <Route path="/ranking" element={<RankingPage />} />
          <Route path="/calendario" element={<ClanWarsSchedulePage />} />
          <Route path="/clan-war/:id" element={<ClanWarLineupPublicoPage />} />
          {/* La Tienda se descartó por completo -- la ruta se mantiene
              únicamente para redirigir a Inicio a quien tenga un
              enlace o marcador viejo, en vez de mostrar una página
              rota. */}
          <Route path="/store" element={<Navigate to="/" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
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
