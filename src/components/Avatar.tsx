interface AvatarProps {
  url: string | null | undefined;
  // Nombre o nick de la persona: se usa solo para sacar la inicial de
  // respaldo cuando no hay foto -- no se muestra como texto.
  nombre: string | null | undefined;
  // Clase de tamaño (ej. "detail-participant-avatar", "header-avatar",
  // "profile-avatar"): define ancho/alto/radio, se combina acá con el
  // estilo de "sin foto" cuando corresponde.
  className: string;
}

// Componente compartido para no repetir en cada lista el ternario
// "hay avatar_url -> <img>, si no -> círculo con la inicial". Se usa
// en el header, la lista de participantes de un torneo, la de
// miembros de un equipo y /perfil.
export default function Avatar({ url, nombre, className }: AvatarProps) {
  if (url) {
    return <img src={url} alt="" className={className} />;
  }

  return (
    <span className={`${className} avatar-placeholder`}>
      {(nombre ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}
