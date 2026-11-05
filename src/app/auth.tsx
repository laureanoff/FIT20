import type { Session } from '@supabase/supabase-js';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  /** El usuario llegó desde el email de recuperación: debe elegir una contraseña nueva. */
  recovering: boolean;
  clearRecovering: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    // getSession lee localStorage: funciona sin internet.
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ session, loading, recovering, clearRecovering: () => setRecovering(false) }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}

/** Traduce los errores de Supabase Auth a mensajes claros en castellano. */
export function authErrorMessage(err: { message?: string; code?: string; status?: number } | null | undefined): string {
  if (!err) return '';
  const m = `${err.code ?? ''} ${err.message ?? ''}`.toLowerCase();
  if (!navigator.onLine || /fetch|network/.test(m)) return 'Sin conexión. Iniciar sesión o crear la cuenta necesita internet la primera vez.';
  if (/invalid.*credentials|invalid_credentials/.test(m)) return 'Email o contraseña incorrectos.';
  if (/email.*not.*confirmed/.test(m)) return 'Todavía no confirmaste tu email. Revisá tu bandeja de entrada (y la carpeta de spam).';
  if (/already.*registered|user_already_exists/.test(m)) return 'Ya existe una cuenta con ese email. Probá iniciar sesión.';
  if (/weak.*password|password.*(short|least)/.test(m)) return 'La contraseña es muy débil: usá al menos 8 caracteres combinando letras y números.';
  if (/rate.?limit|too many|429/.test(m) || err.status === 429) return 'Demasiados intentos. Esperá unos minutos y volvé a probar.';
  if (/same.*password/.test(m)) return 'La contraseña nueva tiene que ser distinta de la anterior.';
  return 'No pudimos completar la operación. Probá de nuevo en unos minutos.';
}
