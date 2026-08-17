// Envio outbound pela rota não-oficial (Evolution API). As duas rotas coexistem:
// cada conversa responde pelo provedor por onde a mensagem chegou — o `channel`
// da conversa guarda o nome do provider, e as credenciais das duas podem estar
// configuradas juntas.
//
// A rota oficial ('whatsapp'/'instagram', via Zernio) não passa por aqui.

import { getCredential } from '../credentials.ts';
import { EvolutionProvider } from './evolution-provider.ts';
import { connectionForConversation, providerFor } from './department-routing.ts';

export function isEvolutionChannel(channel: string | null | undefined): boolean {
  return channel === 'evolution' || channel === 'uazapi';
}

export async function loadEvolutionProvider(): Promise<EvolutionProvider> {
  const serverUrl = (await getCredential('evolution_server_url')) ?? '';
  const apiKey = (await getCredential('evolution_api_key')) ?? '';
  const instance = (await getCredential('evolution_instance')) ?? '';
  if (!serverUrl || !apiKey || !instance) {
    throw new Error('Credenciais Evolution ausentes (server URL / API key / instance).');
  }
  return new EvolutionProvider(serverUrl, apiKey, instance);
}

export async function loadUazapiProvider(): Promise<EvolutionProvider> {
  const serverUrl = (await getCredential('uazapi_server_url')) ?? '';
  const apiKey = (await getCredential('uazapi_api_key')) ?? '';
  const instance = (await getCredential('uazapi_instance')) ?? '';
  if (!serverUrl || !apiKey || !instance) {
    throw new Error('Credenciais UAZAPI ausentes (server URL / API key / instance).');
  }
  return new EvolutionProvider(serverUrl, apiKey, instance, 'uazapi');
}

// Envia texto (e opcionalmente mídia) para o telefone do contato via Evolution.
//
// `connectionId` é a linha por onde a conversa entrou, e é por ela que a
// resposta sai. Um departamento pode ter dezenas de números: responder por
// outro faria o contato receber de alguém que nunca procurou.
export async function sendEvolutionMessage(
  phone: string,
  text: string,
  mediaUrl?: string | null,
  mediaType?: string,
  connectionId?: string | null,
  channel?: string | null,
): Promise<{ messageId: string | null; providerName: 'evolution' | 'uazapi' }> {
  const conn = channel === 'uazapi' ? null : await connectionForConversation(connectionId);
  const provider = conn
    ? providerFor(conn)
    : channel === 'uazapi'
      ? await loadUazapiProvider()
      : await loadEvolutionProvider();
  const result = await provider.sendMessage(phone, text, {
    mediaUrl: mediaUrl ?? undefined,
    mediaType,
  });
  if (!result.ok) {
    throw new Error(result.error ?? 'Erro ao enviar via Evolution.');
  }
  return { messageId: result.messageId, providerName: provider.name };
}
