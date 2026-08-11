import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import {
  CUSTOM_FIELD_TYPE_LABEL,
  type CustomField,
  type CustomFieldType,
} from '@/types/crm';

export const dealInputClass =
  'w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[0.65rem] uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">{label}</div>
      {children}
    </div>
  );
}

// Edição inline: clica → vira input; Enter/blur salva (com validação); Esc cancela.
export function InlineText({
  value, onSave, type = 'text', placeholder, validate, render, className,
}: {
  value: string;
  onSave: (value: string) => void | Promise<void>;
  type?: 'text' | 'number' | 'email' | 'tel';
  placeholder?: string;
  validate?: (v: string) => string | null;
  render?: (v: string) => string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setLocal(value), [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = () => {
    const problem = validate?.(local) ?? null;
    if (problem) { setErr(problem); return; }
    setErr(null);
    setEditing(false);
    if (local !== value) void onSave(local);
  };

  if (!editing) {
    const shown = value ? (render ? render(value) : value) : (placeholder ?? '—');
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`block w-full truncate text-left hover:opacity-80 ${value ? '' : 'text-[var(--color-text-secondary)] opacity-70'} ${className ?? ''}`}
        title="Clique para editar"
      >
        {shown}
      </button>
    );
  }

  return (
    <div>
      <input
        ref={ref}
        type={type}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setLocal(value); setErr(null); setEditing(false); } }}
        placeholder={placeholder}
        className="w-full rounded border border-[rgba(59,130,246,0.3)] bg-white/[0.05] px-2 py-1 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]"
      />
      {err && <div className="mt-1 text-xs text-[#EF4444]">{err}</div>}
    </div>
  );
}

// Subtítulo do drawer: exibe TODOS os produtos selecionados e, ao clicar, abre
// um dropdown de múltipla escolha com o catálogo (Configurações → Produtos).
export function ProductsSubtitle({
  products,
  catalog,
  fallback,
  onToggle,
}: {
  products: { id: string; name: string }[];
  catalog: { id: string; name: string }[];
  fallback: string;
  onToggle: (p: { id: string; name: string }, selected: boolean) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const selectedIds = new Set(products.map((p) => p.id));
  const label = products.length > 0 ? products.map((p) => p.name).join(', ') : fallback;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-1 text-left text-sm text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)]"
        title="Selecionar produtos"
      >
        <span className="min-w-0 truncate">
          {products.length > 0 ? label : <span className="opacity-70">{fallback} — selecionar produtos…</span>}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-[rgba(59,130,246,0.25)] bg-[#0A0A0F] p-1 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
            {catalog.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                Nenhum produto cadastrado — crie em Configurações → Produtos.
              </div>
            ) : (
              catalog.map((p) => {
                const selected = selectedIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void onToggle(p, selected)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-text-primary)] transition hover:bg-white/5"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        selected
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]'
                          : 'border-[rgba(59,130,246,0.35)]'
                      }`}
                    >
                      {selected && <Check className="h-3 w-3 text-white" />}
                    </span>
                    <span className="min-w-0 truncate">{p.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Multi-select com autocomplete de catálogo + criação ao digitar. Usado por
// Produtos e Tags.
export function ChipEditor({
  label, chips, catalog, onAdd, onRemove, colored,
}: {
  label: string;
  chips: { id: string; name: string; color?: string }[];
  catalog: { id: string; name: string; color?: string }[];
  onAdd: (name: string) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  colored?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const chosen = new Set(chips.map((c) => c.name.toLowerCase()));
  const suggestions = catalog
    .filter((c) => !chosen.has(c.name.toLowerCase()) && c.name.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 6);
  const exact = catalog.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());

  const add = async (name: string) => {
    await onAdd(name);
    setQ('');
    setOpen(false);
  };

  return (
    <section className="space-y-2">
      <div className="text-label">{label}</div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
              style={colored && c.color ? { background: `${c.color}22`, color: c.color } : undefined}
            >
              {(!colored || !c.color) && <span className="text-[var(--color-text-primary)]">{c.name}</span>}
              {colored && c.color && c.name}
              <button onClick={() => void onRemove(c.id)} className="opacity-70 hover:opacity-100" aria-label={`Remover ${c.name}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { e.preventDefault(); void add(q.trim()); } }}
          placeholder={`Adicionar ${label.toLowerCase()}…`}
          className={dealInputClass}
        />
        {open && (q.trim() || suggestions.length > 0) && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-[rgba(59,130,246,0.25)] bg-[#0A0A0F] p-1 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
              {suggestions.map((s) => (
                <button key={s.id} onClick={() => void add(s.name)} className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-white/5">
                  {s.name}
                </button>
              ))}
              {q.trim() && !exact && (
                <button onClick={() => void add(q.trim())} className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-[var(--accent-secondary)] hover:bg-white/5">
                  <Plus className="h-3 w-3" /> Criar “{q.trim()}”
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function CustomFieldInput({ field, value, onSave }: { field: CustomField; value: string; onSave: (value: string) => void | Promise<void> }) {
  const [local, setLocal] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setLocal(value), [value]);

  const commit = (v: string) => {
    if (field.required && !v.trim()) { setErr(`"${field.label}" é obrigatório.`); return; }
    setErr(null);
    void onSave(v);
  };

  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-[0.65rem] uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">
        {field.label}{field.required && <span className="text-[#EF4444]">*</span>}
      </div>
      {field.field_type === 'boolean' ? (
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <input type="checkbox" checked={local === 'true'} onChange={(e) => { const v = e.target.checked ? 'true' : 'false'; setLocal(v); commit(v); }} className="h-4 w-4 accent-[#3B82F6]" />
          {local === 'true' ? 'Sim' : 'Não'}
        </label>
      ) : field.field_type === 'select' ? (
        <select value={local} onChange={(e) => { setLocal(e.target.value); commit(e.target.value); }} className={dealInputClass}>
          <option value="">Selecione…</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => commit(local)}
          className={dealInputClass}
        />
      )}
      {err && <div className="mt-1 text-xs text-[#EF4444]">{err}</div>}
    </div>
  );
}

export function CustomFieldModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (input: { label: string; field_type: CustomFieldType; options: string[] | null; required: boolean }) => void | Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [optionsRaw, setOptionsRaw] = useState('');
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!label.trim()) { setErr('Informe o nome do campo.'); return; }
    const options = type === 'select' ? optionsRaw.split(',').map((o) => o.trim()).filter(Boolean) : null;
    if (type === 'select' && (!options || options.length === 0)) { setErr('Informe ao menos uma opção (separadas por vírgula).'); return; }
    setBusy(true);
    await onCreate({ label: label.trim(), field_type: type, options, required });
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-[rgba(59,130,246,0.25)] bg-[#0A0A0F] p-5 shadow-[0_0_40px_rgba(59,130,246,0.15)]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-display">Novo campo personalizado</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-[0.65rem] uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">Nome do campo</div>
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: CNPJ, Segmento…" className={dealInputClass} />
          </div>
          <div>
            <div className="mb-1 text-[0.65rem] uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">Tipo</div>
            <select value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} className={dealInputClass}>
              {(Object.keys(CUSTOM_FIELD_TYPE_LABEL) as CustomFieldType[]).map((t) => <option key={t} value={t}>{CUSTOM_FIELD_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          {type === 'select' && (
            <div>
              <div className="mb-1 text-[0.65rem] uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">Opções (separadas por vírgula)</div>
              <input value={optionsRaw} onChange={(e) => setOptionsRaw(e.target.value)} placeholder="A, B, C" className={dealInputClass} />
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-primary)]">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4 accent-[#3B82F6]" /> Obrigatório
          </label>
          {err && <div className="text-xs text-[#EF4444]">{err}</div>}
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={submit} disabled={busy} className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
            <Check className="h-4 w-4" /> {busy ? 'Criando…' : 'Criar campo'}
          </button>
          <button onClick={onClose} className="rounded-lg border border-[rgba(59,130,246,0.2)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
