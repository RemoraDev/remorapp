import { Link } from "react-router-dom";

// Guía de instalación de la PWA en celular -- se abre en una pestaña
// nueva desde la tarjeta "Instalar en celular" de Inicio
// (InstalarRemorApp.tsx). El paso exacto varía según el navegador: en
// Chrome el ícono de instalación suele aparecer directo en la barra de
// direcciones, mientras que en Brave (y en versiones de Chrome donde
// no aparece ese ícono) hay que ir al menú de tres puntos.
export default function InstalarCelularPage() {
  return (
    <section className="section section-page">
      <h1 className="section-title">Instalar RemorApp en tu celular</h1>
      <p className="tournament-card-meta">
        RemorApp funciona como una PWA (Progressive Web App): se instala directo desde el navegador, sin
        pasar por Google Play, y ocupa muy poco espacio. Una vez instalada, se abre como una app aparte,
        con su propio ícono en la pantalla de inicio.
      </p>

      <h2 className="detail-subtitle">Chrome (Android)</h2>
      <div className="obs-config-ayuda">
        <ol>
          <li>Abrí RemorApp en Chrome.</li>
          <li>
            Tocá el menú de tres puntos (⋮) arriba a la derecha. Si Chrome ya detectó que se puede
            instalar, vas a ver directamente un ícono de instalación en la barra de direcciones -- podés
            tocar ese ícono en vez del menú.
          </li>
          <li>Elegí la opción "Instalar app" (puede aparecer como "Agregar a pantalla de inicio").</li>
          <li>Confirmá tocando "Instalar" en el cuadro que aparece.</li>
        </ol>
      </div>

      <h2 className="detail-subtitle">Brave (Android)</h2>
      <div className="obs-config-ayuda">
        <ol>
          <li>Abrí RemorApp en Brave.</li>
          <li>Tocá el menú (⋮) arriba a la derecha.</li>
          <li>
            Buscá la opción "Agregar a pantalla de inicio" o "Instalar app" -- en Brave el texto exacto
            puede variar según la versión.
          </li>
          <li>Confirmá la instalación cuando te lo pida.</li>
        </ol>
      </div>

      <p className="tournament-card-meta">
        Si no ves ninguna opción de instalar en tu navegador, actualizá el navegador a la última versión
        e intentá de nuevo -- la instalación de PWA necesita una versión relativamente reciente.
      </p>

      <Link to="/" className="btn btn-ghost">
        ← Volver a Inicio
      </Link>
    </section>
  );
}
