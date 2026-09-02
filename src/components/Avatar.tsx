import type { AvatarForma } from "../types/profile";

interface AvatarProps {
  url: string | null | undefined;
  // Nombre o nick de la persona: se usa solo para sacar la inicial de
  // respaldo cuando no hay foto -- no se muestra como texto.
  nombre: string | null | undefined;
  // Clase de tamaño (ej. "detail-participant-avatar", "header-avatar",
  // "profile-avatar"): define ancho/alto, se combina acá con el
  // estilo de "sin foto" y con la forma cuando corresponde.
  className: string;
  // Preferencia de forma del DUEÑO de este avatar (profiles.avatar_forma,
  // migración 031). Se omite (y cae a "redondo") para cosas que no son
  // el avatar de una persona -- como un logo de equipo -- que nunca
  // están sujetas a esta preferencia.
  forma?: AvatarForma;
}

// Componente compartido para no repetir en cada lista el ternario
// "hay avatar_url -> <img>, si no -> círculo/cuadrado con la inicial".
// Se usa en el header, la lista de participantes de un torneo, la de
// miembros de un equipo y /perfil.
export default function Avatar({ url, nombre, className, forma = "redondo" }: AvatarProps) {
  const claseForma = forma === "cuadrado" ? "avatar-shape-cuadrado" : "avatar-shape-redondo";

  if (url) {
    return <img src={url} alt="" className={`${className} ${claseForma}`} />;
  }

  return (
    <span className={`${className} avatar-placeholder ${claseForma}`}>
      {(nombre ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}
