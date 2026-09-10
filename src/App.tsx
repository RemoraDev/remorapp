import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Header from "./components/Header";
import BottomNav from "./components/BottomNav";

// Cada página se carga en su propio chunk (React.lazy) en vez de ir todas
// en el bundle inicial -- antes de esto, visitar la home descargaba el JS
// de las 27 páginas de la app (overlays de OBS, admin, etc.) de una sola vez.
const OverlayClanWarPage = lazy(() => import("./pages/OverlayClanWarPage"));
const OverlayLineupClanWarPage = lazy(() => import("./pages/OverlayLineupClanWarPage"));
const OverlayTorneoPage = lazy(() => import("./pages/OverlayTorneoPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const TournamentsPage = lazy(() => import("./pages/TournamentsPage"));
const CreateTournamentPage = lazy(() => import("./pages/CreateTournamentPage"));
const TournamentDetailPage = lazy(() => import("./pages/TournamentDetailPage"));
const TournamentHistoryPage = lazy(() => import("./pages/TournamentHistoryPage"));
const HistoricalTournamentsPage = lazy(() => import("./pages/HistoricalTournamentsPage"));
const HallOfFamePage = lazy(() => import("./pages/HallOfFamePage"));
const PlayerDetailPage = lazy(() => import("./pages/PlayerDetailPage"));
const MyTournamentsPage = lazy(() => import("./pages/MyTournamentsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const PruebasLineupObservarPage = lazy(() => import("./pages/PruebasLineupObservarPage"));
const TeamsPage = lazy(() => import("./pages/TeamsPage"));
const CreateTeamPage = lazy(() => import("./pages/CreateTeamPage"));
const TeamDetailPage = lazy(() => import("./pages/TeamDetailPage"));
const NewsPage = lazy(() => import("./pages/NewsPage"));
const AyudaPage = lazy(() => import("./pages/AyudaPage"));
const RankingPage = lazy(() => import("./pages/RankingPage"));
const ClanWarsSchedulePage = lazy(() => import("./pages/ClanWarsSchedulePage"));
const ClanWarLineupPublicoPage = lazy(() => import("./pages/ClanWarLineupPublicoPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));

function PageFallback() {
  return <div className="page-fallback">Cargando...</div>;
}

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
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/overlay/cw/:id" element={<OverlayClanWarPage />} />
          <Route path="/overlay/lineup/:id" element={<OverlayLineupClanWarPage />} />
          <Route path="/overlay/torneo/:id" element={<OverlayTorneoPage />} />
        </Routes>
      </Suspense>
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
        <Suspense fallback={<PageFallback />}>
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
        </Suspense>
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
