import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import type { PerfilTipo } from "../types/profile";

export interface Profile {
  id: string;
  nombre: string | null;
  perfil_tipo: PerfilTipo | null;
  es_admin: boolean;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
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
  const [loading, setLoading] = useState(true);

  const cargarPerfil = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, nombre, perfil_tipo, es_admin")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error cargando perfil:", error);
      setProfile(null);
      return;
    }

    setProfile(data);
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
      value={{ session, user: session?.user ?? null, profile, loading, signOut, refreshProfile }}
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
