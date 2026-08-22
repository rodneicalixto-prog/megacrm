import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';
import { getSupabase } from '@/lib/supabase';

// ----------------------------------------------------------------------------
// AppUserProvider
// ----------------------------------------------------------------------------
// Self-hosted single-org build: there is no tenant concept. The only thing
// we surface to consumers is the role read from auth.jwt().app_metadata.role
// (populated by the on_auth_user_created trigger).
//
// Role gating elsewhere in the app should consume `useAppUser().role` instead
// of querying the DB; the JWT is the source of truth for access control.
// ----------------------------------------------------------------------------

export type AppRole = 'super_admin' | 'admin' | 'supervisor' | 'operator';

// Papeis com alcance administrativo. Usado pelos gates da UI — lembrando que
// esconder no menu nao e permissao: quem barra e a RLS.
export const ADMIN_ROLES: AppRole[] = ['super_admin', 'admin'];

interface AppUserContextValue {
  userId: string | null;
  role: AppRole | null;
  loading: boolean;
}

const AppUserContext = createContext<AppUserContextValue | null>(null);

function readRoleFromUser(appMetadata: Record<string, unknown> | undefined): AppRole | null {
  if (!appMetadata) return null;
  const role = appMetadata['role'];
  if (role === 'super_admin' || role === 'admin' || role === 'supervisor' || role === 'operator') {
    return role;
  }
  return null;
}

// Heartbeat de presença: chama a RPC set_own_presence a cada 45s enquanto a
// sessão estiver ativa. O round-robin de handoff (next_department_assignee)
// só considera "online" quem tem last_seen_at nos últimos 2min — bem folgado
// em relação a este intervalo — então uma aba fechada sem aviso (crash,
// notebook fechado) expira sozinha em vez de ficar "online" pra sempre.
const HEARTBEAT_INTERVAL_MS = 45_000;

function usePresenceHeartbeat(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabase();

    const ping = (online: boolean) => {
      void supabase.schema('whatsapp_hub').rpc('set_own_presence', { p_online: online });
    };

    ping(true);
    const interval = window.setInterval(() => ping(true), HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      // Melhor esforço: cobre logout/troca de usuário na mesma aba. Fechar a
      // aba direto não dispara isso — para esse caso vale a expiração acima.
      ping(false);
    };
  }, [userId]);
}

export function AppUserProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  const role = useMemo(
    () => readRoleFromUser(user?.app_metadata as Record<string, unknown> | undefined),
    [user],
  );
  const userId = user?.id ?? null;

  usePresenceHeartbeat(userId);

  const value = useMemo<AppUserContextValue>(
    () => ({ userId, role, loading }),
    [userId, role, loading],
  );

  return <AppUserContext.Provider value={value}>{children}</AppUserContext.Provider>;
}

export function useAppUser(): AppUserContextValue {
  const ctx = useContext(AppUserContext);
  if (!ctx) {
    throw new Error('useAppUser must be used inside <AppUserProvider>');
  }
  return ctx;
}
