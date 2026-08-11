import { Check, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { setupConfig } from '../../../../setup.config';
import { PrepItem, PrimaryButton } from './SetupChrome';
import type { CoreValues, FieldKey, ValidationMap } from './setupCore';

export interface TimelineStep {
  label: string;
  key: string;
}

export function PreparationStep({ isRerun, onContinue }: { isRerun: boolean; onContinue: () => void }) {
  return (
    <>
      <h1 className="mb-2 text-[28px] font-semibold text-[#F8FAFC]">
        {isRerun ? 'Aplicar atualizacoes' : setupConfig.toolName}
      </h1>
      {isRerun ? (
        <div className="mb-8 rounded-lg border border-[rgba(59,130,246,0.25)] bg-[rgba(59,130,246,0.06)] p-4">
          <p className="text-sm leading-[1.6] text-[#CBD5E1]">
            Esta instalacao ja esta configurada. Rodar de novo aplica as{' '}
            <strong className="text-[#F8FAFC]">migrations novas</strong> e redeploya as{' '}
            <strong className="text-[#F8FAFC]">Edge Functions</strong> — nada e apagado, e o que ja foi aplicado e pulado.
          </p>
          <p className="mt-2 text-sm leading-[1.6] text-[#94A3B8]">
            Precisa de tres campos: a URL do Supabase, a Service Role Key e o Personal Access Token.
            Nao pede token da Vercel nem a senha do dono — uma reexecucao nao cria conta nem redeploya o site.
          </p>
        </div>
      ) : (
        <p className="mb-8 text-base leading-[1.6] text-[#94A3B8]">
          Antes de iniciar, deixe abertas as contas onde voce vai copiar os tokens de bootstrap.
        </p>
      )}
      <div className="space-y-4">
        <PrepItem n={1} title="Criar projeto Supabase" text="Crie um projeto vazio e copie URL, anon key e service role key." href="https://supabase.com/dashboard/new" pills={['SUPABASE_URL', 'ANON_KEY', 'SERVICE_ROLE']} />
        <PrepItem n={2} title="Gerar PAT Supabase" text="Crie um Personal Access Token para rodar migrations e deployar Edge Functions." href="https://supabase.com/dashboard/account/tokens" pills={['SUPABASE_PAT']} />
        <PrepItem n={3} title="Gerar Vercel Token" text="Crie um token para o wizard configurar envs core e disparar o redeploy." href="https://vercel.com/account/tokens" pills={['VERCEL_TOKEN']} />
      </div>
      <div className="mt-8 flex justify-end">
        <PrimaryButton onClick={onContinue}>Ja tenho tudo isso, continuar</PrimaryButton>
      </div>
    </>
  );
}

interface CredentialsStepProps {
  fields: FieldKey[];
  core: CoreValues;
  validation: ValidationMap;
  revealed: Record<FieldKey, boolean>;
  ready: boolean;
  bootstrapping: boolean;
  onChange: (key: FieldKey, value: string) => void;
  onToggleReveal: (key: FieldKey) => void;
  onBack: () => void;
  onConfigure: () => void;
}

export function CredentialsStep(props: CredentialsStepProps) {
  return (
    <>
      <h1 className="mb-2 text-[28px] font-semibold text-[#F8FAFC]">Credenciais core</h1>
      <p className="mb-8 text-base leading-[1.6] text-[#94A3B8]">
        Estas credenciais sao usadas uma vez para preparar a instancia. Senha do owner nao fica salva.
      </p>
      <div className="grid gap-4">
        {props.fields.map((key) => {
          const isSecret = key.includes('key') || key.includes('token') || key.includes('password');
          return (
            <div key={key}>
              <label className="mb-1.5 block text-[13px] font-medium text-[#CBD5E1]">{key.toUpperCase()}</label>
              <div className="relative">
                <input
                  type={isSecret && !props.revealed[key] ? 'password' : 'text'}
                  value={props.core[key]}
                  onChange={(event) => props.onChange(key, event.target.value)}
                  autoComplete={key === 'owner_password' ? 'new-password' : 'off'}
                  className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 py-3 pr-16 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:outline-none focus:shadow-[0_0_20px_rgba(59,130,246,0.2)]"
                />
                <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                  {isSecret ? (
                    <button type="button" aria-label={props.revealed[key] ? 'Ocultar' : 'Mostrar'} onClick={() => props.onToggleReveal(key)} className="text-[#94A3B8] hover:text-[#F8FAFC]">
                      {props.revealed[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  ) : null}
                  {props.validation[key]?.ok ? <Check className="h-4 w-4 text-[#10B981]" /> : props.validation[key] ? <X className="h-4 w-4 text-[#EF4444]" /> : null}
                </div>
              </div>
              {props.validation[key]?.message ? (
                <p className={props.validation[key]?.ok ? 'mt-1 text-xs text-[#10B981]' : 'mt-1 text-xs text-[#EF4444]'}>{props.validation[key]?.message}</p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={props.onBack} className="min-h-11 w-full rounded-lg border border-[rgba(59,130,246,0.25)] bg-white/[0.03] px-5 text-sm font-medium text-[#F8FAFC] transition hover:border-[#3B82F6] sm:w-auto">Voltar</button>
        <PrimaryButton disabled={!props.ready || props.bootstrapping} onClick={props.onConfigure}>Configurar</PrimaryButton>
      </div>
    </>
  );
}

interface BootstrapStepProps {
  isRerun: boolean;
  steps: TimelineStep[];
  timeline: string[];
  waiting: boolean;
  timedOut: boolean;
  bootstrapping: boolean;
  ownerPassword: string;
  onOwnerPasswordChange: (value: string) => void;
  onVerifyAgain: () => void;
  onContinue: () => void;
  onRetry: () => void;
}

export function BootstrapStep(props: BootstrapStepProps) {
  const visibleSteps = props.isRerun ? props.steps.slice(0, 3) : props.steps;
  return (
    <>
      <h1 className="mb-2 text-[28px] font-semibold text-[#F8FAFC]">Bootstrap</h1>
      <p className="mb-8 text-base leading-[1.6] text-[#94A3B8]">Preparando Supabase, Edge Functions, owner e Vercel.</p>
      <div className="space-y-3">
        {visibleSteps.map((entry) => (
          <div key={entry.label} className="flex items-center gap-3 rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-4">
            {props.timeline.includes(entry.label) ? <Check className="h-5 w-5 text-[#10B981]" /> : <Loader2 className="h-5 w-5 animate-spin text-[#60A5FA]" />}
            <span className="text-sm text-[#F8FAFC]">{entry.label}</span>
          </div>
        ))}
      </div>
      {props.waiting ? <p className="mt-6 text-center text-sm text-[#94A3B8]">O Vercel esta publicando o novo deployment com as envs. Isso pode levar alguns minutos.</p> : null}
      {props.timedOut ? (
        <div className="mt-8 rounded-xl border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.06)] p-5">
          <p className="text-sm leading-5 text-[#F8FAFC]">O redeploy esta demorando mais que o esperado. Verifique o status em{' '}<a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer" className="text-[#60A5FA] underline hover:text-[#85B7EB]">vercel.com/dashboard</a>. Quando o app estiver no ar, continue.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={props.onVerifyAgain} className="min-h-11 rounded-lg border border-[rgba(59,130,246,0.25)] bg-white/[0.03] px-5 text-sm font-medium text-[#F8FAFC] transition hover:border-[#3B82F6]">Verificar de novo</button>
            <PrimaryButton onClick={props.onContinue}>Continuar mesmo assim</PrimaryButton>
          </div>
        </div>
      ) : !props.bootstrapping && !props.waiting ? (
        <div className="mt-8 space-y-3">
          {!props.ownerPassword ? (
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-[#CBD5E1]">Reinforme a senha do owner para retomar</label>
              <input type="password" value={props.ownerPassword} onChange={(event) => props.onOwnerPasswordChange(event.target.value)} placeholder="senha do owner" autoComplete="current-password" className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 py-3 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:outline-none focus:shadow-[0_0_20px_rgba(59,130,246,0.2)]" />
            </div>
          ) : null}
          <div className="flex justify-end"><PrimaryButton disabled={!props.ownerPassword} onClick={props.onRetry}>Tentar de novo</PrimaryButton></div>
        </div>
      ) : null}
    </>
  );
}
