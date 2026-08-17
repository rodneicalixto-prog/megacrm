// Fábrica de provedores de WhatsApp. O core de reconciliação pede um provider
// pelo nome (ou deixa a config decidir) e recebe a interface — nunca o adapter
// concreto.

import { ZernioProvider } from './zernio-provider.ts';
import { EvolutionProvider } from './evolution-provider.ts';
import type { ProviderName, WhatsAppProvider } from './types.ts';

export * from './types.ts';
export { ZernioProvider } from './zernio-provider.ts';
export { EvolutionProvider } from './evolution-provider.ts';

export interface ProviderCredentials {
  zernio_api_key?: string | null;
  zernio_api_base_url?: string | null;
  evolution_server_url?: string | null;
  evolution_api_key?: string | null;
  evolution_instance?: string | null;
  uazapi_server_url?: string | null;
  uazapi_api_key?: string | null;
  uazapi_instance?: string | null;
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
  if (name === 'uazapi') {
    const serverUrl = creds.uazapi_server_url ?? creds.evolution_server_url;
    const apiKey = creds.uazapi_api_key ?? creds.evolution_api_key;
    const instance = creds.uazapi_instance ?? creds.evolution_instance;
    if (!serverUrl || !apiKey || !instance) {
      return null;
    }
    return new EvolutionProvider(serverUrl, apiKey, instance, 'uazapi');
  }
  return null;
}

// Seleciona o provider correto para um webhook recebido. A rota sabe de qual
// endpoint veio; como fallback, tenta Zernio (tem assinatura própria) e depois
// Evolution.
export function resolveInboundProvider(
  hint: ProviderName | undefined,
  creds: ProviderCredentials,
): WhatsAppProvider | null {
  if (hint) return makeProvider(hint, creds);
  return makeProvider('zernio', creds) ?? makeProvider('uazapi', creds) ?? makeProvider('evolution', creds);
}
