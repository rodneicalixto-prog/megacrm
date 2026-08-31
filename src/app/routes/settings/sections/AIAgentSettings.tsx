import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Copy, FlaskConical, History, Instagram, Loader2, MessageCircle, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { useAiObservabilityByProfile } from '@/hooks/useAiObservability';

const DEFAULT_PROMPT = `Você é um assistente virtual de atendimento via WhatsApp.
Seja objetivo, educado e responda em português do Brasil.`;

// Modelos GPT mais atuais disponíveis para escolha.
const GPT_MODELS = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini'];

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Manaus',
  'America/Rio_Branco',
  'America/Bahia',
  'UTC',
];

const DEFAULT_VARIABLES: Record<string, string> = {
  nome_do_agente: 'Sophia',
  nome_da_empresa: 'Agentise',
  segmento: 'Educação em IA',
  produtos_servicos: 'Ferramentas de IA',
};

// Variáveis preenchidas automaticamente em runtime (process-ai-message).
// Aparecem no autocomplete mas não são editáveis aqui.
const AUTO_VARS = [
  'nome_do_contato',
  'agora',
  'dentro_do_horario',
  'horario_atendimento',
  'mensagem_fora_horario',
  'midias_disponiveis',
];

type VarRow = { key: string; value: string };

// Perfil de IA (Onda 4) — cada linha de ai_agent_config é uma variante
// testável em A/B/C/D; a lista completa aparece no seletor de perfis.
interface ProfileRow {
  id: string;
  name: string;
  variant_key: string;
  is_active: boolean;
  is_control: boolean;
  traffic_pct: number;
  active_whatsapp: boolean;
}

// Versionamento de prompt (PLANEJAMENTO.md Onda 3) — snapshot gravado pela
// trigger _snapshot_ai_agent_config a cada UPDATE em ai_agent_config.
interface AgentHistoryRow {
  id: string;
  system_prompt: string | null;
  temperature: number | null;
  max_tokens: number | null;
  created_at: string;
}

function toRows(obj: Record<string, string> | null | undefined): VarRow[] {
  const src = obj && Object.keys(obj).length ? obj : DEFAULT_VARIABLES;
  return Object.entries(src).map(([key, value]) => ({ key, value: String(value ?? '') }));
}

// Preenche o formulário a partir de uma linha crua do Supabase.
function applyRowToForm(
  data: Record<string, unknown>,
  setters: {
    setRowId: (v: string) => void;
    setSystemPrompt: (v: string) => void;
    setTemperature: (v: number) => void;
    setMaxTokens: (v: number) => void;
    setActiveWhatsapp: (v: boolean) => void;
    setActiveInstagram: (v: boolean) => void;
    setAutoMoveLeads: (v: boolean) => void;
    setModel: (v: string) => void;
    setTimezone: (v: string) => void;
    setVariables: (v: VarRow[]) => void;
    setName: (v: string) => void;
    setTrafficPct: (v: number) => void;
    setIsControl: (v: boolean) => void;
  },
) {
  setters.setRowId(data.id as string);
  setters.setSystemPrompt((data.system_prompt as string) ?? DEFAULT_PROMPT);
  setters.setTemperature(Number(data.temperature ?? 0.7));
  setters.setMaxTokens(Number(data.max_tokens ?? 1000));
  setters.setActiveWhatsapp(Boolean(data.active_whatsapp ?? true));
  setters.setActiveInstagram(Boolean(data.active_instagram ?? false));
  setters.setAutoMoveLeads(Boolean(data.auto_move_leads ?? true));
  setters.setModel((data.model as string) ?? 'gpt-4.1-mini');
  setters.setTimezone((data.timezone as string) ?? 'America/Sao_Paulo');
  setters.setVariables(toRows(data.variables as Record<string, string> | null));
  setters.setName((data.name as string) ?? 'Principal');
  setters.setTrafficPct(Number(data.traffic_pct ?? 100));
  setters.setIsControl(Boolean(data.is_control ?? true));
}

export function AIAgentSettings() {
  const { userId } = useAppUser();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [rowId, setRowId] = useState<string | null>(null);
  const [name, setName] = useState('Principal');
  const [trafficPct, setTrafficPct] = useState(100);
  const [isControl, setIsControl] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [activeWhatsapp, setActiveWhatsapp] = useState(true);
  const [activeInstagram, setActiveInstagram] = useState(false);
  const [autoMoveLeads, setAutoMoveLeads] = useState(true);
  const [model, setModel] = useState('gpt-4.1-mini');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [variables, setVariables] = useState<VarRow[]>(toRows(DEFAULT_VARIABLES));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<AgentHistoryRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { byProfile: obsByProfile } = useAiObservabilityByProfile(30);

  // Autocomplete de variáveis ao digitar "{" no prompt.
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [varMenu, setVarMenu] = useState<{ partial: string; pos: number } | null>(null);

  const setterBag = {
    setRowId, setSystemPrompt, setTemperature, setMaxTokens, setActiveWhatsapp,
    setActiveInstagram, setAutoMoveLeads, setModel, setTimezone, setVariables,
    setName, setTrafficPct, setIsControl,
  };

  const loadProfiles = async (selectId?: string) => {
    const { data } = await getSupabase()
      .from('ai_agent_config')
      .select('*')
      .order('created_at', { ascending: true });
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    setProfiles(
      rows.map((r) => ({
        id: r.id as string,
        name: (r.name as string) ?? 'Principal',
        variant_key: (r.variant_key as string) ?? '',
        is_active: Boolean(r.is_active ?? true),
        is_control: Boolean(r.is_control ?? true),
        traffic_pct: Number(r.traffic_pct ?? 100),
        active_whatsapp: Boolean(r.active_whatsapp ?? true),
      })),
    );
    const target = (selectId && rows.find((r) => r.id === selectId)) || rows[0];
    if (target) applyRowToForm(target, setterBag);
    return rows;
  };

  useEffect(() => {
    if (!userId) return;
    void loadProfiles().then(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const selectProfile = (row: ProfileRow) => {
    void getSupabase()
      .from('ai_agent_config')
      .select('*')
      .eq('id', row.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) applyRowToForm(data, setterBag);
      });
  };

  const createProfile = async () => {
    setSaving(true);
    const key = `variante-${Date.now().toString(36)}`;
    const { data, error } = await getSupabase()
      .from('ai_agent_config')
      .insert({
        name: `Variante ${profiles.length + 1}`,
        variant_key: key,
        system_prompt: DEFAULT_PROMPT,
        is_active: true,
        is_control: false,
        traffic_pct: 0,
        active_whatsapp: false,
        active_instagram: false,
      })
      .select('id')
      .single();
    setSaving(false);
    if (error) {
      toast.error('Falha ao criar perfil', { description: error.message });
      return;
    }
    toast.success('Novo perfil criado — ajuste o tráfego e ative o canal quando estiver pronto.');
    await loadProfiles((data as { id: string }).id);
  };

  const duplicateProfile = async (row: ProfileRow) => {
    setSaving(true);
    const { data: full } = await getSupabase().from('ai_agent_config').select('*').eq('id', row.id).maybeSingle();
    if (!full) {
      setSaving(false);
      return;
    }
    const key = `${(full.variant_key as string) || 'variante'}-copia-${Date.now().toString(36)}`;
    const { id: _id, created_at: _createdAt, updated_at: _updatedAt, variant_key: _vk, ...rest } = full as Record<string, unknown>;
    const { data, error } = await getSupabase()
      .from('ai_agent_config')
      .insert({ ...rest, name: `${row.name} (cópia)`, variant_key: key, is_control: false, traffic_pct: 0 })
      .select('id')
      .single();
    setSaving(false);
    if (error) {
      toast.error('Falha ao duplicar perfil', { description: error.message });
      return;
    }
    toast.success('Perfil duplicado com peso 0% — ajuste antes de ativar.');
    await loadProfiles((data as { id: string }).id);
  };

  const togglePause = async (row: ProfileRow) => {
    const { error } = await getSupabase()
      .from('ai_agent_config')
      .update({ is_active: !row.is_active })
      .eq('id', row.id);
    if (error) {
      toast.error('Falha ao atualizar perfil', { description: error.message });
      return;
    }
    await loadProfiles(rowId ?? undefined);
  };

  const deleteProfile = async (row: ProfileRow) => {
    if (profiles.length <= 1) {
      toast.error('Não é possível remover o único perfil de IA.');
      return;
    }
    if (!confirm(`Remover o perfil "${row.name}"? Métricas já registradas continuam associadas a ele.`)) return;
    const { error } = await getSupabase().from('ai_agent_config').delete().eq('id', row.id);
    if (error) {
      toast.error('Falha ao remover perfil', { description: error.message });
      return;
    }
    toast.success(`Perfil "${row.name}" removido.`);
    await loadProfiles();
  };

  useEffect(() => {
    if (!rowId) return;
    void getSupabase()
      .from('ai_agent_config_history')
      .select('id, system_prompt, temperature, max_tokens, created_at')
      .eq('config_id', rowId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setHistory((data ?? []) as AgentHistoryRow[]));
  }, [rowId]);

  const restoreVersion = (h: AgentHistoryRow) => {
    setSystemPrompt(h.system_prompt ?? DEFAULT_PROMPT);
    if (h.temperature != null) setTemperature(h.temperature);
    if (h.max_tokens != null) setMaxTokens(h.max_tokens);
    toast.info('Versão carregada no formulário — clique em "Salvar alterações" para aplicar.');
  };

  const varKeys = useMemo(
    () => [...variables.map((v) => v.key.trim()).filter(Boolean), ...AUTO_VARS],
    [variables],
  );

  const menuMatches = useMemo(() => {
    if (!varMenu) return [];
    const p = varMenu.partial.toLowerCase();
    return varKeys.filter((k) => k.toLowerCase().startsWith(p)).slice(0, 8);
  }, [varMenu, varKeys]);

  const onPromptChange = (value: string) => {
    setSystemPrompt(value);
    const caret = promptRef.current?.selectionStart ?? value.length;
    // Texto entre o último "{" e o cursor, sem "}" no meio → abre o menu.
    const before = value.slice(0, caret);
    const match = before.match(/\{([a-z0-9_]*)$/i);
    if (match) setVarMenu({ partial: match[1], pos: caret - match[1].length });
    else setVarMenu(null);
  };

  const insertVariable = (key: string) => {
    if (!varMenu) return;
    const start = varMenu.pos;
    const caret = promptRef.current?.selectionStart ?? systemPrompt.length;
    const next = systemPrompt.slice(0, start) + key + '}' + systemPrompt.slice(caret);
    setSystemPrompt(next);
    setVarMenu(null);
    // Reposiciona o cursor após o "}".
    const newCaret = start + key.length + 1;
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  const setVar = (i: number, patch: Partial<VarRow>) =>
    setVariables((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const addVar = () => setVariables((prev) => [...prev, { key: '', value: '' }]);
  const removeVar = (i: number) => setVariables((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    // Normaliza variáveis: chaves a-z0-9_ , descarta linhas sem chave.
    const varsObj: Record<string, string> = {};
    for (const { key, value } of variables) {
      const k = key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (k) varsObj[k] = value;
    }
    setSaving(true);
    const supabase = getSupabase();
    const payload = {
      system_prompt: systemPrompt,
      temperature,
      max_tokens: maxTokens,
      active_whatsapp: activeWhatsapp,
      active_instagram: activeInstagram,
      auto_move_leads: autoMoveLeads,
      model,
      timezone,
      variables: varsObj,
      name: name.trim() || 'Principal',
      traffic_pct: Math.max(0, Math.min(100, Math.round(trafficPct))),
      is_control: isControl,
    };
    let savedId = rowId;
    let error: { message: string } | null = null;
    if (rowId) {
      ({ error } = await supabase.from('ai_agent_config').update(payload).eq('id', rowId));
    } else {
      const { data, error: insErr } = await supabase
        .from('ai_agent_config')
        .insert({ ...payload, is_active: true, variant_key: `perfil-${Date.now().toString(36)}` })
        .select('id')
        .single();
      error = insErr;
      savedId = (data as { id: string } | null)?.id ?? null;
    }
    setSaving(false);
    if (error) {
      toast.error('Falha ao salvar', { description: error.message });
      return;
    }
    toast.success('Configuração do agente salva.');
    await loadProfiles(savedId ?? undefined);
    if (rowId) {
      const { data } = await supabase
        .from('ai_agent_config_history')
        .select('id, system_prompt, temperature, max_tokens, created_at')
        .eq('config_id', rowId)
        .order('created_at', { ascending: false })
        .limit(10);
      setHistory((data ?? []) as AgentHistoryRow[]);
    }
  };

  const trafficTotalWhatsapp = profiles
    .filter((p) => p.is_active && p.active_whatsapp)
    .reduce((sum, p) => sum + p.traffic_pct, 0);

  if (loading) {
    return (
      <Card>
        <div className="text-label opacity-60 py-8 text-center">Carregando...</div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-display flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-[var(--accent-secondary)]" />
              Perfis de IA
            </h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Cada perfil é uma personalidade testável. O mesmo contato sempre cai no mesmo
              perfil (hash do telefone), distribuído pelo % de tráfego de cada um.
            </p>
          </div>
          <Button type="button" size="sm" onClick={createProfile} disabled={saving}>
            <Plus className="h-3.5 w-3.5" /> Novo perfil
          </Button>
        </div>
        {trafficTotalWhatsapp !== 100 && profiles.some((p) => p.is_active) && (
          <div className="rounded-lg border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs text-[#FBBF24]">
            Atenção: perfis ativos no WhatsApp somam {trafficTotalWhatsapp}% de tráfego (deveria
            somar 100%).
          </div>
        )}
        <div className="space-y-2">
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                p.id === rowId
                  ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.08)]'
                  : 'border-[rgba(59,130,246,0.12)] bg-white/[0.02] hover:border-[rgba(59,130,246,0.25)]'
              }`}
              onClick={() => selectProfile(p)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  {p.name}
                  {p.is_control && (
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-text-secondary)]">
                      Controle
                    </span>
                  )}
                  {!p.is_active && (
                    <span className="rounded-full bg-[rgba(239,68,68,0.12)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-error)]">
                      Pausado
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--color-text-secondary)]">
                  {p.traffic_pct}% do tráfego
                  {(() => {
                    const o = obsByProfile.get(p.id);
                    if (!o || o.messages === 0) return null;
                    const total = o.feedbackUp + o.feedbackDown;
                    const pct = total > 0 ? Math.round((o.feedbackUp / total) * 100) : null;
                    return ` · ${o.messages} respostas · $${o.costUsd.toFixed(3)}${pct != null ? ` · ${pct}% 👍` : ''}`;
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <Button type="button" variant="ghost" size="icon" onClick={() => duplicateProfile(p)} aria-label={`Duplicar ${p.name}`}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => togglePause(p)} aria-label={p.is_active ? `Pausar ${p.name}` : `Ativar ${p.name}`}>
                  {p.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => deleteProfile(p)} aria-label={`Remover ${p.name}`}>
                  <Trash2 className="h-3.5 w-3.5 text-[var(--color-error)]" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
      <form onSubmit={handleSubmit} className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-xl font-bold text-display">Editando: {name || 'Perfil'}</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            O system prompt define a personalidade e as regras. Use {'{variavel}'} para
            inserir variáveis (digite {'{'} para escolher).
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="profile_name">Nome do perfil</Label>
            <Input id="profile_name" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="traffic_pct">Tráfego (%)</Label>
            <Input
              id="traffic_pct"
              type="number"
              min={0}
              max={100}
              value={trafficPct}
              onChange={(e) => setTrafficPct(Number(e.target.value))}
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label>Controle</Label>
            <label className="flex items-center gap-2 h-11 px-3 rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03]">
              <input
                type="checkbox"
                checked={isControl}
                onChange={(e) => setIsControl(e.target.checked)}
                disabled={saving}
                className="accent-[var(--accent-primary)] h-4 w-4"
              />
              <span className="text-sm text-[var(--color-text-primary)]">Marcar como controle</span>
            </label>
          </div>
        </div>

        <div className="space-y-2 relative">
          <Label htmlFor="system_prompt">System prompt</Label>
          <textarea
            id="system_prompt"
            ref={promptRef}
            value={systemPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onBlur={() => setTimeout(() => setVarMenu(null), 150)}
            rows={12}
            disabled={saving}
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--accent-primary)] focus:bg-white/[0.06]"
          />
          {varMenu && menuMatches.length > 0 && (
            <div className="absolute z-20 mt-1 w-64 rounded-lg border border-[rgba(59,130,246,0.25)] bg-[var(--color-bg-elevated)] shadow-2xl overflow-hidden">
              {menuMatches.map((k) => (
                <button
                  key={k}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertVariable(k);
                  }}
                  className="block w-full text-left px-3 py-2 text-sm font-mono text-[var(--color-text-primary)] hover:bg-[rgba(59,130,246,0.12)]"
                >
                  {`{${k}}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Variáveis */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Variáveis</Label>
            <Button type="button" variant="ghost" size="sm" onClick={addVar} disabled={saving}>
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </Button>
          </div>
          <p className="text-[11px] text-[var(--color-text-secondary)] opacity-70">
            Chave e valor. Referencie no prompt com {'{chave}'}. Automáticas (preenchidas
            em runtime): {AUTO_VARS.map((k) => `{${k}}`).join(', ')}.
          </p>
          <div className="space-y-2">
            {variables.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={v.key}
                  onChange={(e) => setVar(i, { key: e.target.value })}
                  placeholder="chave"
                  disabled={saving}
                  className="font-mono max-w-[220px]"
                />
                <span className="text-[var(--color-text-secondary)]">=</span>
                <Input
                  value={v.value}
                  onChange={(e) => setVar(i, { value: e.target.value })}
                  placeholder="valor"
                  disabled={saving}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeVar(i)}
                  disabled={saving}
                  aria-label="Remover variável"
                >
                  <Trash2 className="h-4 w-4 text-[var(--color-error)]" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Canais ativos (Módulo 6) — cada canal liga/desliga a IA de forma
            independente. Desligado → conversas do canal vão direto para humano.
            São o interruptor principal da IA (não há mais toggle global). */}
        <div className="space-y-2">
          <Label>Canais atendidos pela IA</Label>
          <p className="text-[11px] text-[var(--color-text-secondary)] opacity-70">
            Ligue ou desligue a IA por canal. Se um canal estiver desligado, as conversas
            dele vão direto para atendimento humano.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl">
            <label className="flex items-center gap-3 h-11 px-4 rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] cursor-pointer">
              <input
                type="checkbox"
                checked={activeWhatsapp}
                onChange={(e) => setActiveWhatsapp(e.target.checked)}
                disabled={saving}
                className="accent-[var(--accent-primary)] h-4 w-4"
              />
              <MessageCircle className="h-4 w-4 text-[#25D366]" />
              <span className="text-sm text-[var(--color-text-primary)]">
                Ativo no WhatsApp
              </span>
            </label>
            <label className="flex items-center gap-3 h-11 px-4 rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] cursor-pointer">
              <input
                type="checkbox"
                checked={activeInstagram}
                onChange={(e) => setActiveInstagram(e.target.checked)}
                disabled={saving}
                className="accent-[var(--accent-primary)] h-4 w-4"
              />
              <Instagram className="h-4 w-4 text-[#E1306C]" />
              <span className="text-sm text-[var(--color-text-primary)]">
                Ativo no Instagram
              </span>
            </label>
          </div>
        </div>

        {/* Movimento automático de leads no funil (Módulo 8) */}
        <div className="space-y-2">
          <Label>Funil</Label>
          <label className="flex items-center gap-3 min-h-11 px-4 py-2 rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] cursor-pointer max-w-2xl">
            <input
              type="checkbox"
              checked={autoMoveLeads}
              onChange={(e) => setAutoMoveLeads(e.target.checked)}
              disabled={saving}
              className="accent-[var(--accent-primary)] h-4 w-4 shrink-0"
            />
            <span className="text-sm text-[var(--color-text-primary)]">
              Mover leads no funil automaticamente
              <span className="block text-[11px] text-[var(--color-text-secondary)]">
                Com sinal claro, a IA move o card entre estágios (que tenham critério definido) e
                registra no histórico. Reversível arrastando de volta.
              </span>
            </span>
          </label>
        </div>

        {/* Configurações Avançadas */}
        <div className="rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02]">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              Configurações Avançadas
            </div>
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-[var(--color-text-secondary)] transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {advancedOpen && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-[rgba(59,130,246,0.1)] p-5">
              <div className="space-y-2">
                <Label htmlFor="model">Modelo de IA</Label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={saving}
                  className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 text-sm text-[var(--color-text-primary)]"
                >
                  {GPT_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Fuso horário</Label>
                <select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  disabled={saving}
                  className="h-11 w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 text-sm text-[var(--color-text-primary)]"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="temperature">Temperature ({temperature.toFixed(1)})</Label>
                <input
                  id="temperature"
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  disabled={saving}
                  className="w-full accent-[var(--accent-primary)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max_tokens">Max tokens</Label>
                <Input
                  id="max_tokens"
                  type="number"
                  min={100}
                  max={8000}
                  step={100}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  disabled={saving}
                />
              </div>
            </div>
          )}
        </div>

        {history.length > 0 && (
          <div className="space-y-2 border-t border-[rgba(59,130,246,0.1)] pt-4">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold text-[var(--accent-secondary)]"
            >
              <History className="h-4 w-4" />
              Histórico de versões ({history.length})
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
            </button>
            {historyOpen && (
              <div className="space-y-2">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-start gap-3 rounded-lg border border-[rgba(59,130,246,0.15)] bg-white/[0.02] px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-[var(--color-text-secondary)]">
                        {new Date(h.created_at).toLocaleString('pt-BR')} · temp {h.temperature ?? '—'} · max {h.max_tokens ?? '—'} tokens
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-[var(--color-text-secondary)]">
                        {h.system_prompt || '(prompt vazio)'}
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => restoreVersion(h)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>Salvar alterações</>
            )}
          </Button>
        </div>
      </form>
      </Card>
    </div>
  );
}
