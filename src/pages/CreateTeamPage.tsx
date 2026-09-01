import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { obtenerEquipoDelUsuario, recortarImagenCuadrada } from "../lib/teams";
import type { EquipoDelUsuario } from "../lib/teams";
import { contieneLenguajeInapropiado } from "../lib/profanityFilter";
import { SC2_REGION_OPTIONS } from "../types/profile";
import type { Sc2Region } from "../types/profile";

const TAG_REGEX = /^[A-Z]{3,6}$/;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export default function CreateTeamPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [nombre, setNombre] = useState("");
  const [tag, setTag] = useState("");
  const [regiones, setRegiones] = useState<Sc2Region[]>([]);
  const [descripcion, setDescripcion] = useState("");
  const [esPublico, setEsPublico] = useState(true);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [equipoActual, setEquipoActual] = useState<EquipoDelUsuario | null>(null);
  const [cargandoEquipoActual, setCargandoEquipoActual] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setCargandoEquipoActual(false);
      return;
    }
    obtenerEquipoDelUsuario(user.id).then((equipo) => {
      setEquipoActual(equipo);
      setCargandoEquipoActual(false);
    });
  }, [user]);

  const toggleRegion = (region: Sc2Region) => {
    setRegiones((prev) =>
      prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]
    );
  };

  const handleLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const archivo = event.target.files?.[0] ?? null;
    setError(null);

    if (!archivo) {
      setLogoFile(null);
      setLogoPreview(null);
      return;
    }

    if (archivo.size > LOGO_MAX_BYTES) {
      setError("El logo no puede pesar más de 2MB.");
      event.target.value = "";
      return;
    }

    setLogoFile(archivo);
    setLogoPreview(URL.createObjectURL(archivo));
  };

  if (!authLoading && !user) {
    return (
      <section className="page-placeholder">
        <h1>Inicia sesión para crear un equipo</h1>
        <p>
          <Link to="/login" className="btn-link">
            Iniciar sesión
          </Link>
        </p>
      </section>
    );
  }

  if (authLoading || !profile || cargandoEquipoActual) return null;

  if (profile.suspendido) {
    return (
      <section className="page-placeholder">
        <h1>Tu cuenta está suspendida</h1>
      </section>
    );
  }

  if (!profile.cuenta_validada) {
    return (
      <section className="page-placeholder">
        <h1>Completa tu perfil primero</h1>
        <p>
          <Link to="/perfil" className="btn-link">
            Ir a Mi perfil
          </Link>
        </p>
      </section>
    );
  }

  if (equipoActual) {
    return (
      <section className="page-placeholder">
        <h1>Ya perteneces a un equipo</h1>
        <p>Por ahora solo puedes estar en un equipo a la vez.</p>
      </section>
    );
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const nombreLimpio = nombre.trim();
    const tagNormalizado = tag.trim().toUpperCase();

    if (nombreLimpio.length < 3 || nombreLimpio.length > 20) {
      setError("El nombre del equipo tiene que tener entre 3 y 20 caracteres.");
      return;
    }
    if (!TAG_REGEX.test(tagNormalizado)) {
      setError("El tag tiene que ser de 3 a 6 letras mayúsculas, sin números ni símbolos.");
      return;
    }
    if (regiones.length === 0) {
      setError("Elige al menos un servidor.");
      return;
    }
    if (
      contieneLenguajeInapropiado(nombreLimpio) ||
      contieneLenguajeInapropiado(tagNormalizado) ||
      (descripcion.trim() && contieneLenguajeInapropiado(descripcion))
    ) {
      setError("Ese nombre, tag o descripción no está permitido wn, cámbialo.");
      return;
    }

    setLoading(true);
    setError(null);

    // Chequeo de tag único por servidor -- esto es solo para mostrar el
    // aviso al toque; el trigger validar_tag_unico_por_servidor en la
    // base es el que de verdad lo hace imposible (ver migración 005).
    const { data: conflictos } = await supabase
      .from("teams")
      .select("sc2_regions")
      .eq("tag", tagNormalizado)
      .overlaps("sc2_regions", regiones);

    if (conflictos && conflictos.length > 0) {
      const regionEnConflicto = conflictos
        .flatMap((t) => t.sc2_regions as Sc2Region[])
        .find((r) => regiones.includes(r));
      const label =
        SC2_REGION_OPTIONS.find((o) => o.value === regionEnConflicto)?.label ?? "ese servidor";
      setError(`Ese tag ya está pillado en ${label} wn, prueba otro.`);
      setLoading(false);
      return;
    }

    let logoUrl: string | null = null;
    if (logoFile) {
      try {
        const recorte = await recortarImagenCuadrada(logoFile);
        const extension = logoFile.type === "image/png" ? "png" : "jpg";
        const ruta = `${user.id}/${Date.now()}-logo.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("team-logos")
          .upload(ruta, recorte, { contentType: recorte.type });

        if (uploadError) {
          setError("No se pudo subir el logo: " + uploadError.message);
          setLoading(false);
          return;
        }

        logoUrl = supabase.storage.from("team-logos").getPublicUrl(ruta).data.publicUrl;
      } catch {
        setError("No se pudo procesar el logo, prueba con otra imagen.");
        setLoading(false);
        return;
      }
    }

    const { data: equipo, error: teamError } = await supabase
      .from("teams")
      .insert({
        name: nombreLimpio,
        tag: tagNormalizado,
        sc2_regions: regiones,
        description: descripcion.trim() || null,
        logo_url: logoUrl,
        is_public: esPublico,
        owner_id: user.id,
      })
      .select()
      .single();

    setLoading(false);

    if (teamError || !equipo) {
      setError(teamError?.message ?? "No se pudo crear el equipo.");
      return;
    }

    navigate(`/equipos/${equipo.tag}`);
  };

  return (
    <section className="auth-page">
      <h1 className="auth-title">Crear equipo</h1>
      <p className="auth-sub">Arma tu clan y compite en RemorApp.</p>

      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="team-nombre">
            Nombre del equipo
          </label>
          <input
            id="team-nombre"
            className="form-input"
            type="text"
            required
            minLength={3}
            maxLength={20}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="team-tag">
            Tag (3-6 letras)
          </label>
          <input
            id="team-tag"
            className="form-input"
            type="text"
            required
            minLength={3}
            maxLength={6}
            value={tag}
            onChange={(e) => setTag(e.target.value.toUpperCase())}
          />
        </div>

        <div className="form-group">
          <span className="form-label">Servidores en los que juega el equipo</span>
          <div className="form-radio-group">
            {SC2_REGION_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`form-radio-option ${regiones.includes(option.value) ? "selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={regiones.includes(option.value)}
                  onChange={() => toggleRegion(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="team-descripcion">
            Descripción (opcional)
          </label>
          <textarea
            id="team-descripcion"
            className="form-textarea"
            maxLength={280}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="team-logo">
            Logo (opcional, máx. 2MB, se recorta a 1:1)
          </label>
          <input
            id="team-logo"
            className="form-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleLogoChange}
          />
          {logoPreview && (
            <img src={logoPreview} alt="Vista previa del logo" className="team-logo-preview" />
          )}
        </div>

        <div className="form-group">
          <span className="form-label">Visibilidad</span>
          <div className="form-radio-group">
            <label className={`form-radio-option ${esPublico ? "selected" : ""}`}>
              <input type="radio" name="esPublico" checked={esPublico} onChange={() => setEsPublico(true)} />
              Público
            </label>
            <label className={`form-radio-option ${!esPublico ? "selected" : ""}`}>
              <input
                type="radio"
                name="esPublico"
                checked={!esPublico}
                onChange={() => setEsPublico(false)}
              />
              Privado
            </label>
          </div>
          {!esPublico && (
            <p className="form-hint">No va a aparecer en el buscador — solo por código de invitación.</p>
          )}
        </div>

        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Creando equipo..." : "Crear equipo"}
        </button>
      </form>
    </section>
  );
}
