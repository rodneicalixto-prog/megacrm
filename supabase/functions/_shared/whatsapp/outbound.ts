// Envio outbound pela rota não-oficial (Evolution API). As duas rotas coexistem:
// cada conversa responde pelo provedor por onde a mensagem chegou — o `channel`
// da conversa guarda o nome do provider, e as credenciais das duas podem estar
// configuradas juntas.
//
// A rota oficial ('whatsapp'/'instagram', via Zernio) não passa por aqui.

import { getCredential } from '../credentials.ts';
import { EvolutionProvider } from './evolution-provider.ts';

export function isEvolutionChannel(channel: string | null | undefined): boolean {
  return channel === 'evolution';
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

// Envia texto (e opcionalmente mídia) para o telefone do contato via Evolution.
export async function sendEvolutionMessage(
  phone: string,
  text: string,
  mediaUrl?: string | null,
  mediaType?: string,
): Promise<{ messageId: string | null }> {
  const provider = await loadEvolutionProvider();
  const result = await provider.sendMessage(phone, text, {
    mediaUrl: mediaUrl ?? undefined,
    mediaType,
  });
  if (!result.ok) {
    throw new Error(result.error ?? 'Erro ao enviar via Evolution.');
  }
  return { messageId: result.messageId };
}
