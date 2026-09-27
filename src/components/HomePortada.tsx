import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isTauri } from "@tauri-apps/api/core";
import { ArrowRight, Download, Monitor } from "lucide-react";
import { formatFecha } from "../lib/formatters";
import type { NoticiaPreview } from "./NewsSection";

interface Props {
  noticiasDestacadas: NoticiaPreview[];
  onVerProximosEventos: () => void;
}

// Mismo link estable de GitHub Releases que usa InstalarRemorApp.tsx
// (ver ese componente para el detalle de por qué es estable entre
// versiones).
const URL_INSTALADOR_WINDOWS = "https://github.com/RemoraDev/remorapp/releases/latest/download/RemorApp-Setup.exe";

// Portada de Inicio (primera página del carrusel): título de marca,
// hasta 3 noticias destacadas si es que hay (las siguientes, si
// existen, van en páginas de Noticias aparte -- ver HomePage.tsx), un
// llamado a la acción que lleva directo a la página de "Clan Wars
// próximas" del mismo carrusel, y una tarjeta de descarga para PC
// (corrección: la portada se sentía "muerta" sin ningún elemento
// visual propio) -- oculta cuando la app YA corre en escritorio
// (Tauri), no tiene sentido ofrecer bajarla desde adentro suyo.
export default function HomePortada({ noticiasDestacadas, onVerProximosEventos }: Props) {
  const [esEscritorio, setEsEscritorio] = useState(false);

  useEffect(() => {
    if (isTauri()) setEsEscritorio(true);
  }, []);

  return (
    <div className="home-portada">
      <div className="home-portada-glow" aria-hidden="true" />
      <h1 className="home-portada-titulo">
        Bienvenidos a RemorApp<span className="home-portada-titulo-accent"> Gaming</span>
      </h1>
      <div className="home-portada-franja" />

      {noticiasDestacadas.length > 0 && (
        <div className="home-portada-noticias">
          <p className="home-portada-noticias-titulo">Noticias destacadas</p>
          <ul className="home-portada-noticias-lista">
            {noticiasDestacadas.map((n) => (
              <li key={n.id}>
                <Link to="/news" className="home-portada-noticia-item">
                  <span className="home-portada-noticia-fecha">{formatFecha(n.createdAt)}</span>
                  <span className="home-portada-noticia-titulo-texto">{n.titulo}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/news" className="btn-link home-portada-ver-todas">
            Ver todas las noticias
          </Link>
        </div>
      )}

      <button type="button" className="btn btn-primary btn-primary-lg home-portada-cta" onClick={onVerProximosEventos}>
        Ver próximos eventos
        <ArrowRight size={18} className="icon-inline" aria-hidden="true" />
      </button>

      {!esEscritorio && (
        <a href={URL_INSTALADOR_WINDOWS} className="home-portada-descargar-pc">
          <span className="home-portada-descargar-pc-icono" aria-hidden="true">
            <Monitor size={28} />
          </span>
          <span className="home-portada-descargar-pc-texto">
            <span className="home-portada-descargar-pc-titulo">Llevate RemorApp a tu escritorio</span>
            <span className="home-portada-descargar-pc-desc">
              Sin la barra del navegador, con aviso automático de nuevas versiones.
            </span>
          </span>
          <span className="home-portada-descargar-pc-boton">
            <Download size={16} className="icon-inline" aria-hidden="true" />
            Descargar para Windows
          </span>
        </a>
      )}
    </div>
  );
}
