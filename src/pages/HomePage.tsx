import { useEffect, useRef, useState } from "react";
import Carrusel from "../components/Carrusel";
import type { CarruselHandle } from "../components/Carrusel";
import HomePortada from "../components/HomePortada";
import ProximasClanWars from "../components/ProximasClanWars";
import NewsSection from "../components/NewsSection";
import type { NoticiaPreview } from "../components/NewsSection";
import { supabase } from "../lib/supabaseClient";

const NOTICIAS_POR_PAGINA = 3;
// Tope de noticias a traer para Inicio -- 3 en la portada + 2 páginas
// extra de 3 como máximo; el listado completo, sin tope, vive en /news.
const TOPE_NOTICIAS_EN_INICIO = 9;

function partirEnGrupos<T>(items: T[], tamaño: number): T[][] {
  const grupos: T[][] = [];
  for (let i = 0; i < items.length; i += tamaño) {
    grupos.push(items.slice(i, i + tamaño));
  }
  return grupos;
}

// Inicio es un carrusel deslizable, sin scroll vertical de página
// completa -- ver Carrusel.tsx. La primera página es la portada
// (HomePortada.tsx): título "Bienvenidos a RemorApp Gaming" + hasta 3
// noticias destacadas (si hay) + botón "Ver próximos eventos", que
// salta directo a la página de Clan Wars próximas del mismo carrusel
// (sin cambiar de ruta). Si hay MÁS de 3 noticias, el resto se reparte
// en páginas de Noticias aparte, a continuación de la portada.
export default function HomePage() {
  const [noticias, setNoticias] = useState<NoticiaPreview[] | null>(null);
  const carruselRef = useRef<CarruselHandle>(null);

  useEffect(() => {
    supabase
      .from("noticias")
      .select("id, titulo, created_at")
      .order("created_at", { ascending: false })
      .limit(TOPE_NOTICIAS_EN_INICIO)
      .then(({ data, error }) => {
        if (error) {
          console.error("Error cargando noticias:", error);
          setNoticias([]);
          return;
        }
        setNoticias((data ?? []).map((n) => ({ id: n.id, titulo: n.titulo, createdAt: n.created_at })));
      });
  }, []);

  const noticiasDestacadas = (noticias ?? []).slice(0, NOTICIAS_POR_PAGINA);
  const noticiasRestantes = (noticias ?? []).slice(NOTICIAS_POR_PAGINA);
  const paginasNoticiasExtra = partirEnGrupos(noticiasRestantes, NOTICIAS_POR_PAGINA).map((grupo, indice) => ({
    key: `noticias-extra-${indice}`,
    contenido: <NewsSection noticias={grupo} />,
  }));

  // La portada siempre es la página 0 -- las páginas de noticias extra
  // (si las hay) van justo después, y recién ahí "Clan Wars próximas".
  const indiceClanWars = 1 + paginasNoticiasExtra.length;

  return (
    <div className="home-carrusel-page">
      <Carrusel
        ref={carruselRef}
        paginas={[
          {
            key: "portada",
            contenido: (
              <HomePortada
                noticiasDestacadas={noticiasDestacadas}
                onVerProximosEventos={() => carruselRef.current?.irAPagina(indiceClanWars)}
              />
            ),
          },
          ...paginasNoticiasExtra,
          { key: "clanwars", contenido: <ProximasClanWars /> },
        ]}
      />
    </div>
  );
}
