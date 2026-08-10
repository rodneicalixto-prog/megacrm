// Roteamento por numero: cada departamento tem sua propria instancia da
// Evolution, e o numero que RECEBEU a mensagem define o departamento.
//
// O webhook da Evolution ja traz `instance` na raiz do payload, entao um
// endpoint unico atende todos os numeros — nao ha URL por departamento.
//
// Compatibilidade: enquanto `department_connections` estiver vazia, tudo cai no
// departamento padrao usando a credencial global de app_settings. E o que
// mantem a instalacao de hoje funcionando enquanto os numeros sao cadastrados.

import { getAdminClient } from '../supabase-admin.ts';
import { decrypt, getCredential } from '../credentials.ts';
import { EvolutionProvider } from './evolution-provider.ts';

export interface DepartmentConnection {
  departmentId: string;
  instance: string;
  serverUrl: string;
  apiKey: string;
}

// Nome da instancia como a Evolution manda no webhook.
export function instanceFromPayload(payload: unknown): string | null {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const value = root.instance;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// Credencial global — o que a instalacao usa hoje, antes de haver conexao por
// departamento.
async function globalConnection(): Promise<{ serverUrl: string; apiKey: string; instance: string } | null> {
  const serverUrl = (await getCredential('evolution_server_url')) ?? '';
  const apiKey = (await getCredential('evolution_api_key')) ?? '';
  const instance = (await getCredential('evolution_instance')) ?? '';
  if (!serverUrl || !apiKey || !instance) return null;
  return { serverUrl, apiKey, instance };
}

async function defaultDepartmentId(): Promise<string | null> {
  const { data } = await getAdminClient()
    .from('departments').select('id').eq('is_default', true).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// server_url / api_key nulos na linha significam "usar a credencial global":
// util para o primeiro numero, que ja esta configurado no KV.
async function hydrate(row: {
  department_id: string;
  instance: string;
  server_url: string | null;
  api_key_encrypted: string | null;
}): Promise<DepartmentConnection | null> {
  let serverUrl = row.server_url ?? '';
  let apiKey = '';

  if (row.api_key_encrypted) {
    try {
      apiKey = await decrypt(row.api_key_encrypted);
    } catch {
      console.log(JSON.stringify({ event: 'connection_decrypt_failed', instance: row.instance }));
      return null;
    }
  }

  if (!serverUrl || !apiKey) {
    const global = await globalConnection();
    if (!global) return null;
    serverUrl = serverUrl || global.serverUrl;
    apiKey = apiKey || global.apiKey;
  }

  return { departmentId: row.department_id, instance: row.instance, serverUrl, apiKey };
}

// Da instancia que recebeu -> o departamento dono da conversa.
export async function connectionForInstance(instance: string): Promise<DepartmentConnection | null> {
  const { data } = await getAdminClient()
    .from('department_connections')
    .select('department_id, instance, server_url, api_key_encrypted')
    .eq('instance', instance)
    .maybeSingle();

  if (data) return hydrate(data as never);

  // Instancia desconhecida: cai no padrao com a credencial global. NAO adivinha
  // um departamento qualquer — se nao ha padrao, a mensagem e recusada em vez
  // de aterrissar no lugar errado.
  const global = await globalConnection();
  const fallback = await defaultDepartmentId();
  if (!global || !fallback) return null;
  return { departmentId: fallback, instance, serverUrl: global.serverUrl, apiKey: global.apiKey };
}

// Da conversa -> por onde a resposta sai. Tem que ser o mesmo numero por onde
// entrou, senao o contato recebe resposta de um numero que nunca procurou.
export async function connectionForDepartment(departmentId: string): Promise<DepartmentConnection | null> {
  const { data } = await getAdminClient()
    .from('department_connections')
    .select('department_id, instance, server_url, api_key_encrypted')
    .eq('department_id', departmentId)
    .maybeSingle();

  if (data) return hydrate(data as never);

  const global = await globalConnection();
  if (!global) return null;
  return {
    departmentId,
    instance: global.instance,
    serverUrl: global.serverUrl,
    apiKey: global.apiKey,
  };
}

export function providerFor(conn: DepartmentConnection): EvolutionProvider {
  return new EvolutionProvider(conn.serverUrl, conn.apiKey, conn.instance);
}
