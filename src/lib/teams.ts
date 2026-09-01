import { supabase } from "./supabaseClient";
import type { TeamMemberRow } from "../types/teams";

export interface EquipoDelUsuario extends TeamMemberRow {
  teamTag: string | null;
}

// Se usa en /equipos/crear y /equipos para bloquear crear o unirse a
// un segundo equipo -- el chequeo real e imposible de saltarse está en
// la base (team_members.user_id es la primary key), esto es solo para
// mostrar el aviso al toque sin tener que esperar el error del INSERT.
// También se usa en el abanico ("Mi equipo") para saber a qué tag
// mandar directo.
export async function obtenerEquipoDelUsuario(userId: string): Promise<EquipoDelUsuario | null> {
  const { data } = await supabase
    .from("team_members")
    .select("user_id, team_id, roles, joined_at, teams(tag)")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;

  // team_members.team_id -> teams.id: PostgREST embebe el join, pero
  // sin tipos generados puede venir como objeto o como array de 1.
  const equipo = Array.isArray(data.teams) ? data.teams[0] : data.teams;

  return {
    user_id: data.user_id,
    team_id: data.team_id,
    roles: data.roles,
    joined_at: data.joined_at,
    teamTag: (equipo as { tag?: string } | undefined)?.tag ?? null,
  };
}

// Recorte 1:1 simple: toma el cuadrado más grande centrado en la
// imagen (sin arrastrar ni hacer zoom a mano -- eso sería un editor de
// imagen interactivo, que queda afuera del alcance de esta fase).
export function recortarImagenCuadrada(archivo: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(archivo);

    img.onload = () => {
      const lado = Math.min(img.width, img.height);
      const offsetX = (img.width - lado) / 2;
      const offsetY = (img.height - lado) / 2;

      const canvas = document.createElement("canvas");
      canvas.width = lado;
      canvas.height = lado;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo procesar la imagen."));
        return;
      }

      ctx.drawImage(img, offsetX, offsetY, lado, lado, 0, 0, lado, lado);
      URL.revokeObjectURL(url);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("No se pudo procesar la imagen."));
        },
        archivo.type === "image/png" ? "image/png" : "image/jpeg",
        0.9
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };

    img.src = url;
  });
}

// Mismo recorte centrado que recortarImagenCuadrada, pero con una
// proporción ancho:alto arbitraria en vez de forzar 1:1 -- se usa
// para el banner de equipo (4:1). Toma el rectángulo más grande
// centrado en la imagen que respete esa proporción.
export function recortarImagenConProporcion(archivo: File, proporcion: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(archivo);

    img.onload = () => {
      let anchoRecorte = img.width;
      let altoRecorte = img.width / proporcion;

      if (altoRecorte > img.height) {
        altoRecorte = img.height;
        anchoRecorte = img.height * proporcion;
      }

      const offsetX = (img.width - anchoRecorte) / 2;
      const offsetY = (img.height - altoRecorte) / 2;

      const canvas = document.createElement("canvas");
      canvas.width = anchoRecorte;
      canvas.height = altoRecorte;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo procesar la imagen."));
        return;
      }

      ctx.drawImage(img, offsetX, offsetY, anchoRecorte, altoRecorte, 0, 0, anchoRecorte, altoRecorte);
      URL.revokeObjectURL(url);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("No se pudo procesar la imagen."));
        },
        archivo.type === "image/png" ? "image/png" : "image/jpeg",
        0.9
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };

    img.src = url;
  });
}
