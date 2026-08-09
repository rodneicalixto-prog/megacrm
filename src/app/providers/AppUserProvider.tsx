import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthProvider';

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

export function AppUserProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  const role = useMemo(
    () => readRoleFromUser(user?.app_metadata as Record<string, unknown> | undefined),
    [user],
  );

  const value = useMemo<AppUserContextValue>(
    () => ({ userId: user?.id ?? null, role, loading }),
    [user, role, loading],
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
