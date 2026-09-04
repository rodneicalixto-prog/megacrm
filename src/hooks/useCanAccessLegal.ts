import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

// Gate do item de menu "Jurídico". Fail-closed (default false enquanto
// carrega) — diferente de useEnabledModules (fail-open): lá é módulo
// comercial, aqui é um dado sensível por natureza, então preferimos um
// flash de "escondido" a um flash de visível pra quem não devia ver. A RLS
// (whatsapp_hub.can_access_legal()) continua sendo o enforcement de
// verdade — isto é só o gate do menu.
export function useCanAccessLegal() {
  const [canAccess, setCanAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await getSupabase().schema('whatsapp_hub').rpc('can_access_legal');
      if (cancelled) return;
      if (error) {
        console.error('[useCanAccessLegal] falha ao checar acesso', error);
        setCanAccess(false);
      } else {
        setCanAccess(Boolean(data));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { canAccess, loading };
}
