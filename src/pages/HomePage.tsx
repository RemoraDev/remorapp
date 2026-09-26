import { useEffect, useState } from "react";
import Carrusel from "../components/Carrusel";
import ProximasClanWars from "../components/ProximasClanWars";
import NewsSection from "../components/NewsSection";
import type { NoticiaPreview } from "../components/NewsSection";
import InstalarRemorApp from "../components/InstalarRemorApp";
import { supabase } from "../lib/supabaseClient";

const NOTICIAS_POR_PAGINA = 3;
// Tope de noticias a traer para Inicio -- 3 páginas de carrusel como
// máximo; el listado completo, sin tope, vive en /news.
const TOPE_NOTICIAS_EN_INICIO = 9;

function partirEnGrupos<T>(items: T[], tamaño: number): T[][] {
  const grupos: T[][] = [];
  for (let i = 0; i < items.length; i += tamaño) {
    grupos.push(items.slice(i, i + tamaño));
  }
  return grupos;
}

// Migración 110: Inicio pasa a ser un carrusel deslizable (Noticias /
// Próximas Clan Wars / Instalar RemorApp), sin scroll vertical de
// página completa -- ver Carrusel.tsx. Se sacan de acá el título
// "Bienvenidos a RemorApp Gaming" + frase + botón "Mi perfil"
// (Hero.tsx, eliminado -- redundante con el header) y la barra de
// usuarios/torneos (StatsBar.tsx, eliminado -- se mudó al Panel de
// Administración, pestaña "Resumen").
//
// La página de Noticias NO es fija: si todavía no hay ninguna
// publicación cargada, HomePage ni siquiera la incluye en el
// carrusel (mostrar un slide vacío no aporta nada). Si hay más de
// NOTICIAS_POR_PAGINA, se reparten en varias páginas de carrusel en
// vez de truncarse a una sola vista previa.
export default function HomePage() {
  const [noticias, setNoticias] = useState<NoticiaPreview[] | null>(null);

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

  const paginasNoticias =
    noticias === null
      ? [{ key: "noticias-cargando", contenido: <NewsSection cargando /> }]
      : partirEnGrupos(noticias, NOTICIAS_POR_PAGINA).map((grupo, indice) => ({
          key: `noticias-${indice}`,
          contenido: <NewsSection noticias={grupo} />,
        }));

  return (
    <div className="home-carrusel-page">
      <Carrusel
        paginas={[
          ...paginasNoticias,
          { key: "clanwars", contenido: <ProximasClanWars /> },
          { key: "instalar", contenido: <InstalarRemorApp /> },
        ]}
      />
    </div>
  );
}
