import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers/AuthProvider';

// Chaves relevantes lidas via GET /api/credentials?keys=... — mesmo endpoint
// que CredentialsPage.tsx usa pra hidratar o formulário (api/credentials.ts,
// handler GET → credentialExists sobre public.app_settings). Nunca lemos o
// valor da credencial aqui, só a existência (boolean).
const CHECK_KEYS = [
  'zernio_api_key',
  'evolution_server_url',
  'evolution_api_key',
  'evolution_instance',
  'openai_api_key',
  'llm_provider',
  'llm_api_key',
] as const;

type ExistsMap = Partial<Record<(typeof CHECK_KEYS)[number], { exists: boolean }>>;

export interface MissingCredentialsResult {
  loading: boolean;
  /** Nenhum provider de WhatsApp (Zernio ou Evolution completa) configurado. */
  missingWhatsApp: boolean;
  /** Nenhuma chave de LLM disponível para o agente de IA responder. */
  missingLLM: boolean;
}

const has = (exists: ExistsMap, key: (typeof CHECK_KEYS)[number]): boolean =>
  Boolean(exists[key]?.exists);

// Deriva o que falta configurar a partir do mapa de existência. Extraído pra
// função pura só pra facilitar leitura — a lógica de negócio mora aqui, não
// no useEffect.
function deriveMissing(exists: ExistsMap): { missingWhatsApp: boolean; missingLLM: boolean } {
  const zernioConnected = has(exists, 'zernio_api_key');
  const evolutionConnected =
    has(exists, 'evolution_server_url') &&
    has(exists, 'evolution_api_key') &&
    has(exists, 'evolution_instance');

  // llm_api_key só é obrigatória quando o provider não é o padrão (openai);
  // nesse caso a openai_api_key cobre o agente (ver setup.config.ts).
  const openaiConnected = has(exists, 'openai_api_key');
  const altLlmConnected = has(exists, 'llm_provider') && has(exists, 'llm_api_key');

  return {
    missingWhatsApp: !zernioConnected && !evolutionConnected,
    missingLLM: !openaiConnected && !altLlmConnected,
  };
}

// Verifica se as credenciais mínimas (WhatsApp + LLM) já foram configuradas,
// pra alimentar o CredentialsBanner num admin recém-instalado. Reaproveita o
// endpoint /api/credentials (GET) que já existe pra CredentialsPage — nunca
// inventa um jeito novo de ler o cofre de public.app_settings.
export function useMissingCredentials(): MissingCredentialsResult {
  const { session } = useAuth();
  const [exists, setExists] = useState<ExistsMap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch(`/api/credentials?keys=${CHECK_KEYS.join(',')}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((body: ExistsMap) => {
        if (!cancelled) setExists(body);
      })
      .catch(() => {
        // Banner é informativo; falha de rede não deve travar a UI.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!exists) {
    return { loading, missingWhatsApp: false, missingLLM: false };
  }

  return { loading, ...deriveMissing(exists) };
}
