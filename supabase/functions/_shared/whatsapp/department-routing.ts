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
  /** Linha por onde a conversa entrou. A resposta sai por ela, não por outra. */
  connectionId: string | null;
  departmentId: string;
  instance: string;
  serverUrl: string;
  apiKey: string;
  /**
   * Preenchido quando o número é de uma PESSOA, não do departamento. Nesse caso
   * a conversa já nasce atribuída a ela: quem escreveu para o número do Fulano
   * está falando com o Fulano, não entrando numa fila.
   */
  assignToUserId?: string | null;
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
  id?: string;
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

  return { connectionId: row.id ?? null, departmentId: row.department_id, instance: row.instance, serverUrl, apiKey };
}

// Da instancia que recebeu -> o departamento dono da conversa, e, quando o
// numero e de uma pessoa, tambem o responsavel.
export async function connectionForInstance(instance: string): Promise<DepartmentConnection | null> {
  const { data } = await getAdminClient()
    .from('department_connections')
    .select('id, department_id, instance, server_url, api_key_encrypted, position_id')
    .eq('instance', instance)
    .maybeSingle();

  if (data) {
    const conn = await hydrate(data as never);
    if (!conn) return null;
    const positionId = (data as { position_id: string | null }).position_id;
    if (positionId) {
      // Cobertura ativa (colega ausente) tem prioridade sobre o titular do
      // cargo: enquanto durar, mensagens NOVAS nessa linha vão pro cobridor,
      // sem tocar no vínculo cargo->titular (volta a valer sozinho quando a
      // cobertura acaba). Ver 20260822120000_position_coverage_and_multi_line.sql.
      const { data: coverage } = await getAdminClient()
        .from('position_coverage')
        .select('covering_user_id')
        .eq('position_id', positionId)
        .is('ended_at', null)
        .maybeSingle();
      const covering = (coverage as { covering_user_id: string } | null)?.covering_user_id ?? null;
      if (covering) {
        conn.assignToUserId = covering;
      } else {
        const { data: pos } = await getAdminClient()
          .from('department_positions').select('user_id').eq('id', positionId).maybeSingle();
        conn.assignToUserId = (pos as { user_id: string | null } | null)?.user_id ?? null;
      }
    }
    return conn;
  }

  // Instancia desconhecida: cai no padrao com a credencial global. NAO adivinha
  // um departamento qualquer — se nao ha padrao, a mensagem e recusada em vez
  // de aterrissar no lugar errado.
  const global = await globalConnection();
  const fallback = await defaultDepartmentId();
  if (!global || instance !== global.instance || !fallback) return null;
  return { connectionId: null, departmentId: fallback, instance, serverUrl: global.serverUrl, apiKey: global.apiKey };
}

// Por onde a resposta sai: a MESMA linha que recebeu.
//
// Um departamento pode ter dezenas de numeros. Escolher "o numero do
// departamento" faria o contato escrever para uma linha e ser respondido por
// outra — por isso a conversa guarda a conexao, e e ela que manda aqui.
export async function connectionForConversation(
  connectionId: string | null | undefined,
  departmentId?: string | null,
): Promise<DepartmentConnection | null> {
  if (connectionId) {
    const { data } = await getAdminClient()
      .from('department_connections')
      .select('id, department_id, instance, server_url, api_key_encrypted')
      .eq('id', connectionId)
      .maybeSingle();
    if (data) return hydrate(data as never);
  }

  // Conversa anterior ao cadastro de conexoes: cai na credencial global.
  const global = await globalConnection();
  if (!global) return null;
  return {
    connectionId: null,
    departmentId: departmentId ?? '',
    instance: global.instance,
    serverUrl: global.serverUrl,
    apiKey: global.apiKey,
  };
}

export function providerFor(conn: DepartmentConnection): EvolutionProvider {
  return new EvolutionProvider(conn.serverUrl, conn.apiKey, conn.instance);
}
