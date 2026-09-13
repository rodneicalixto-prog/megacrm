import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export interface Operator {
  user_id: string;
  email: string;
  role: 'super_admin' | 'admin' | 'supervisor' | 'operator';
  full_name: string | null;
  department_id: string | null;
  department_name: string | null;
  is_online: boolean;
  last_seen_at: string | null;
}

// Rótulo de uma pessoa na UI. O e-mail sozinho não identifica ninguém quando as
// contas são sufixadas na mesma caixa; o setor desempata dois homônimos.
export function operatorLabel(o: Operator): string {
  const nome = o.full_name?.trim();
  if (!nome) return o.email;
  return o.department_name ? `${nome} — ${o.department_name}` : nome;
}

// list_operators() devolve o is_online bruto de app_users, que só é
// desligado no logout/troca de aba (AppUserProvider.tsx) — uma aba fechada
// sem aviso (crash, notebook fechado) nunca chama esse "ping(false)" e a
// linha fica is_online=true pra sempre. O round-robin de handoff já trata
// isso do lado do banco expirando presença após 2min sem heartbeat; aqui
// replicamos a mesma regra no cliente pra não mostrar "online" eternamente.
const PRESENCE_STALE_MS = 2 * 60 * 1000;

function normalizePresence(rows: Operator[]): Operator[] {
  const now = Date.now();
  return rows.map((row) => {
    if (!row.is_online) return row;
    const seenAt = row.last_seen_at ? new Date(row.last_seen_at).getTime() : NaN;
    const stale = !Number.isFinite(seenAt) || now - seenAt > PRESENCE_STALE_MS;
    return stale ? { ...row, is_online: false } : row;
  });
}

// Estado e polling compartilhados entre todos os consumidores de
// useOperators(): sem isso, cada mount (Header, Inbox, MessageInput,
// TeamChatPage, ...) abria seu próprio setInterval de 30s e multiplicava a
// mesma RPC full-team por tela montada. Um único poll global, com um guard
// de requisição em voo pra não empilhar chamadas se uma demorar mais que o
// intervalo (resposta atrasada sobrescrevendo uma mais nova).
const REFRESH_INTERVAL_MS = 30_000;
type Listener = (operators: Operator[], error: string | null) => void;

let sharedOperators: Operator[] = [];
let sharedError: string | null = null;
let hasLoadedOnce = false;
let inFlight = false;
let intervalId: ReturnType<typeof window.setInterval> | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener(sharedOperators, sharedError);
}

async function loadOperators() {
  if (inFlight) return;
  inFlight = true;
  try {
    const supabase = getSupabase();
    const { data, error: err } = await supabase.schema('whatsapp_hub').rpc('list_operators');
    if (err) {
      console.error('[useOperators] falha ao listar operadores', err);
      sharedError = err.message;
    } else {
      sharedError = null;
      sharedOperators = normalizePresence((data ?? []) as Operator[]);
    }
    hasLoadedOnce = true;
    notify();
  } finally {
    inFlight = false;
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!intervalId) {
    intervalId = window.setInterval(() => void loadOperators(), REFRESH_INTERVAL_MS);
  }
  if (!hasLoadedOnce) {
    void loadOperators();
  } else {
    listener(sharedOperators, sharedError);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  };
}

// Lista os membros da instância (via RPC list_operators) para o seletor de
// atribuição de conversas. Compartilha um único poll de 30s entre todos os
// componentes montados — ver `subscribe`/`loadOperators` acima.
export function useOperators() {
  const [operators, setOperators] = useState<Operator[]>(sharedOperators);
  const [error, setError] = useState<string | null>(sharedError);
  const [loading, setLoading] = useState(!hasLoadedOnce);

  useEffect(() => {
    return subscribe((nextOperators, nextError) => {
      setOperators(nextOperators);
      setError(nextError);
      setLoading(false);
    });
  }, []);

  return { operators, loading, error };
}
