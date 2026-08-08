// Fábrica de provedores de WhatsApp. O core de reconciliação pede um provider
// pelo nome (ou deixa a config decidir) e recebe a interface — nunca o adapter
// concreto.

import { ZernioProvider } from './zernio-provider.ts';
import { UazapiProvider } from './uazapi-provider.ts';
import { EvolutionProvider } from './evolution-provider.ts';
import type { ProviderName, WhatsAppProvider } from './types.ts';

export * from './types.ts';
export { ZernioProvider } from './zernio-provider.ts';
export { UazapiProvider } from './uazapi-provider.ts';
export { EvolutionProvider } from './evolution-provider.ts';

export interface ProviderCredentials {
  zernio_api_key?: string | null;
  zernio_api_base_url?: string | null;
  uazapi_server_url?: string | null;
  uazapi_instance_token?: string | null;
  evolution_server_url?: string | null;
  evolution_api_key?: string | null;
  evolution_instance?: string | null;
}

// Constrói o provider pedido a partir das credenciais disponíveis. Retorna null
// se as credenciais desse provider não estão configuradas.
export function makeProvider(
  name: ProviderName,
  creds: ProviderCredentials,
): WhatsAppProvider | null {
  if (name === 'zernio') {
    if (!creds.zernio_api_key) return null;
    return new ZernioProvider(
      creds.zernio_api_key,
      creds.zernio_api_base_url ?? undefined,
    );
  }
  if (name === 'uazapi') {
    if (!creds.uazapi_server_url || !creds.uazapi_instance_token) return null;
    return new UazapiProvider(creds.uazapi_server_url, creds.uazapi_instance_token);
  }
  if (name === 'evolution') {
    if (!creds.evolution_server_url || !creds.evolution_api_key || !creds.evolution_instance) {
      return null;
    }
    return new EvolutionProvider(
      creds.evolution_server_url,
      creds.evolution_api_key,
      creds.evolution_instance,
    );
  }
  return null;
}

// Seleciona o provider correto para um webhook recebido. A rota sabe de qual
// endpoint veio; como fallback, tenta Zernio (tem assinatura/estrutura própria)
// e depois os não-oficiais.
//
// O fallback entre Uazapi e Evolution é ambíguo — ambos falam Baileys e um
// payload de um parseia no outro. Configurando os dois juntos, aponte o webhook
// para ?provider=evolution (ou =uazapi); sem hint, Uazapi ganha por ser o mais
// antigo e não mudar o comportamento de quem já está instalado.
export function resolveInboundProvider(
  hint: ProviderName | undefined,
  creds: ProviderCredentials,
): WhatsAppProvider | null {
  if (hint) return makeProvider(hint, creds);
  return makeProvider('zernio', creds)
    ?? makeProvider('uazapi', creds)
    ?? makeProvider('evolution', creds);
}
