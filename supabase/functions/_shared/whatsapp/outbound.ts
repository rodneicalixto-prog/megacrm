// Envio outbound pelos provedores diretos (Uazapi, Evolution). Permite WABA
// (Zernio) e os não-oficiais coexistirem: cada conversa responde pelo provedor
// por onde a mensagem chegou — o `channel` da conversa guarda o nome do
// provider. As credenciais de todos podem estar configuradas juntas.

import { getCredential } from '../credentials.ts';
import { makeProvider, type ProviderCredentials } from './index.ts';
import type { ProviderName, WhatsAppProvider } from './types.ts';

// Canais atendidos aqui. 'whatsapp' (WABA/Zernio) e 'instagram' seguem pelo
// caminho próprio do Zernio e não passam por esta função.
const DIRECT_CHANNELS: ProviderName[] = ['uazapi', 'evolution'];

export function isDirectProviderChannel(channel: string | null | undefined): boolean {
  return DIRECT_CHANNELS.includes(channel as ProviderName);
}

export async function loadProvider(channel: string): Promise<WhatsAppProvider> {
  if (!isDirectProviderChannel(channel)) {
    throw new Error(`Canal '${channel}' não é atendido por provedor direto.`);
  }
  const creds: ProviderCredentials =
    channel === 'uazapi'
      ? {
          uazapi_server_url: await getCredential('uazapi_server_url'),
          uazapi_instance_token: await getCredential('uazapi_instance_token'),
        }
      : {
          evolution_server_url: await getCredential('evolution_server_url'),
          evolution_api_key: await getCredential('evolution_api_key'),
          evolution_instance: await getCredential('evolution_instance'),
        };

  const provider = makeProvider(channel as ProviderName, creds);
  if (!provider) throw new Error(`Credenciais do provedor '${channel}' ausentes.`);
  return provider;
}

// Envia texto (e opcionalmente mídia) para o telefone do contato pelo provedor
// do canal da conversa.
export async function sendViaProvider(
  channel: string,
  phone: string,
  text: string,
  mediaUrl?: string | null,
  mediaType?: string,
): Promise<{ messageId: string | null }> {
  const provider = await loadProvider(channel);
  const result = await provider.sendMessage(phone, text, {
    mediaUrl: mediaUrl ?? undefined,
    mediaType,
  });
  if (!result.ok) {
    throw new Error(result.error ?? `Erro ao enviar via ${channel}.`);
  }
  return { messageId: result.messageId };
}
