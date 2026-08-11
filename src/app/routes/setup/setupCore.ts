export type Step = 1 | 2 | 3 | 4;

export type FieldKey =
  | 'supabase_url'
  | 'supabase_anon_key'
  | 'supabase_service_role_key'
  | 'supabase_pat'
  | 'vercel_token'
  | 'owner_email'
  | 'owner_password';

export type CoreValues = Record<FieldKey, string>;
export type ValidationMap = Partial<Record<FieldKey, { ok: boolean; message: string }>>;

export const STORAGE_KEY = 'agentise.setup.step2';

const emptyCore: CoreValues = {
  supabase_url: '',
  supabase_anon_key: '',
  supabase_service_role_key: '',
  supabase_pat: '',
  vercel_token: '',
  owner_email: '',
  owner_password: '',
};

// Network-backed field checks run through the server proxy so tokens never go
// from the browser directly to api.supabase.com or api.vercel.com.
export async function validateCoreField(
  key: FieldKey,
  value: string,
  context: Record<string, string>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'core', key, value, context }),
    });
    const body = (await res.json()) as { ok: boolean; message?: string };
    return { ok: body.ok, message: body.message ?? '' };
  } catch {
    return { ok: false, message: 'Falha ao validar.' };
  }
}

// O estado core vive em localStorage, que é por origem. Sem ele, deep links
// para os passos 3 e 4 não têm credenciais suficientes para funcionar.
export function readSavedCore(): CoreValues {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return emptyCore;
    return { ...emptyCore, ...JSON.parse(saved), owner_password: '' };
  } catch {
    return emptyCore;
  }
}
