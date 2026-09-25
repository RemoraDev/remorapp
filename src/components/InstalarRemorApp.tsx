import { Smartphone, Monitor } from "lucide-react";

// URL estable en GitHub Releases: apunta siempre al instalador de la
// ÚLTIMA versión publicada (hoy, v0.1.0), sin importar el número de
// versión -- depende de que cada publicación futura suba el archivo
// con este mismo nombre exacto (ver docs/publicar-version-escritorio.md).
const URL_INSTALADOR_WINDOWS = "https://github.com/RemoraDev/remorapp/releases/latest/download/RemorApp-Setup.exe";

// Sección "Instalá RemorApp en tu dispositivo", debajo del resto de
// Inicio. Dos tarjetas siempre lado a lado (celular / PC): la de
// celular abre en pestaña nueva la guía de instalación de la PWA
// (varía entre Chrome/Android y Brave/Android); la de PC descarga
// directo el instalador de escritorio (Tauri).
export default function InstalarRemorApp() {
  return (
    <section className="home-instalar-section">
      <h2 className="detail-subtitle">Instalá RemorApp en tu dispositivo</h2>
      <p className="tournament-card-meta">
        Una vez instalada, se abre como una app aparte -- sin la barra de direcciones del navegador --
        y avisa sola cuando haya una versión nueva.
      </p>

      <div className="instalar-cards">
        <a
          href="/instalar-celular"
          target="_blank"
          rel="noopener noreferrer"
          className="instalar-card"
        >
          <Smartphone size={32} aria-hidden="true" />
          <p className="instalar-card-titulo">Instalar en celular</p>
          <p className="instalar-card-desc">Guía paso a paso para Chrome y Brave en Android.</p>
        </a>

        <a href={URL_INSTALADOR_WINDOWS} className="instalar-card">
          <Monitor size={32} aria-hidden="true" />
          <p className="instalar-card-titulo">Instalar en PC</p>
          <p className="instalar-card-desc">Descarga el instalador para Windows.</p>
        </a>
      </div>
    </section>
  );
}
