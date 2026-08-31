import { Link } from "react-router-dom";

export default function Hero() {
  return (
    <section className="hero">
      <p className="hero-tag">Chile · Guatemala · Puerto Rico · Argentina · Perú · Bolivia</p>
      <h1 className="hero-title">
        Tu torneo. <span className="hero-title-accent">Tu comunidad.</span>
        <br />
        Sin fronteras.
      </h1>
      <p className="hero-sub">
        Crea y gestiona torneos de StarCraft II en minutos, juega contra rivales de toda la
        región y hace crecer a tu comunidad.
      </p>
      <Link to="/register" className="btn btn-primary btn-primary-lg hero-cta">
        Crear mi cuenta
      </Link>
    </section>
  );
}
