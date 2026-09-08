/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Delfin Mode -- voz en tiempo real (LiveKit). Vacío hasta que exista
  // una cuenta de LiveKit real -- ver src/lib/voiceChannel.ts.
  readonly VITE_LIVEKIT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
