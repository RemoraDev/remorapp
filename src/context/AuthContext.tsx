import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import type { Profile } from "../types/profile";
import type { SkinAvatarClave } from "../types/skins";

export type { Profile };

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  // Clave técnica de la skin de avatar activa (migración 052), ya
  // resuelta contra el catálogo -- null si no tiene ninguna, o si la
  // consulta al catálogo no trae filas (RLS: solo el dueño de la
  // plataforma puede resolverla, así que para cualquier otra cuenta
  // esto queda en null aunque nunca debería tener skin_avatar_activa
  // asignada de todos modos).
  skinAvatarClave: SkinAvatarClave | null;
  loading: boolean;
  // Invitaciones de equipo pendientes para el usuario logueado -- el
  // contador que se ve en el header. Se recarga junto con el perfil.
  invitacionesPendientes: number;
  signOut: () => Promise<void>;
  // Vuelve a cargar el perfil desde la tabla profiles. Se usa después de
  // guardar cambios (por ejemplo, elegir el tipo de perfil en /perfil) para
  // que el resto de la app (header, menú abanico) se actualice al toque.
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [skinAvatarClave, setSkinAvatarClave] = useState<SkinAvatarClave | null>(null);
  const [invitacionesPendientes, setInvitacionesPendientes] = useState(0);
  const [loading, setLoading] = useState(true);

  const cargarPerfil = useCallback(async (userId: string) => {
    // Se evalúa acá, cada vez que se carga la sesión -- si este
    // perfil lleva 30 días en banca rota sin actividad, lo restaura a
    // 1000 MMR antes de traer el perfil ya actualizado. No hace falta
    // esperar un cron: restaurar_banca_rota_perfil() (en la base) no
    // hace nada si todavía no corresponde.
    await supabase.rpc("restaurar_banca_rota_perfil", { p_user_id: userId });
    // Títulos Padre/Hijo (migración 026): mismo patrón, barrido global
    // -- un título vencido deja de mostrarse como activo.
    await supabase.rpc("expirar_titulos_vencidos");

    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, nombre, perfil_tipo, es_caster, es_admin, nick, unique_id, country, sc2_region, sc2_id, liga, mmr_1v1, mmr_equipos, banca_rota, nivel_1v1, liga_1v1, liga_equipos, valentia_jugador, responsabilidad_cw, responsabilidad_torneos, poco_confiable, gran_maestro_alcanzado_en, avatar_url, avatar_forma, banner_url, bio, links_transmision, horario_stream, carisma, cuenta_validada, suspendido, skin_avatar_activa"
      )
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error cargando perfil:", error);
      setProfile(null);
      setSkinAvatarClave(null);
      return;
    }

    setProfile(data);

    if (data.skin_avatar_activa) {
      const { data: skinData } = await supabase
        .from("catalogo_skins_avatar")
        .select("clave")
        .eq("id", data.skin_avatar_activa)
        .maybeSingle();
      setSkinAvatarClave((skinData?.clave as SkinAvatarClave | undefined) ?? null);
    } else {
      setSkinAvatarClave(null);
    }

    const { count } = await supabase
      .from("team_invitations")
      .select("*", { count: "exact", head: true })
      .eq("invited_user_id", userId)
      .eq("status", "pendiente");

    setInvitacionesPendientes(count ?? 0);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session?.user) {
        cargarPerfil(data.session.user.id);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        cargarPerfil(newSession.user.id);
      } else {
        setProfile(null);
        setSkinAvatarClave(null);
        setInvitacionesPendientes(0);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [cargarPerfil]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (session?.user) {
      await cargarPerfil(session.user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        skinAvatarClave,
        loading,
        invitacionesPendientes,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
