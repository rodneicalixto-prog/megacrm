import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { CredentialField } from '@/components/credentials/CredentialField';
import { WhatsAppProviderCards } from '@/components/setup/WhatsAppProviderCards';
import type { CredentialField as CredentialFieldConfig } from '../../../../setup.config';
import { NO_WHATSAPP_PROVIDER_MESSAGE } from './whatsappProviders';
import { PrimaryButton } from './SetupChrome';

interface ApplicationCredentialsStepProps {
  ownerToken: string | null;
  loginEmail: string;
  loginPassword: string;
  showLoginPassword: boolean;
  loggingIn: boolean;
  zernioField: CredentialFieldConfig;
  evolutionUrlField: CredentialFieldConfig;
  evolutionKeyField: CredentialFieldConfig;
  evolutionInstanceField: CredentialFieldConfig;
  openaiField: CredentialFieldConfig;
  whatsappOk: boolean;
  evolutionOk: boolean;
  evolutionWebhookUrl: string;
  registeringHook: boolean;
  accountChoices: { id: string; name: string }[] | null;
  selectedAccount: string;
  savingApps: boolean;
  allAppValid: boolean;
  setLoginEmail: (value: string) => void;
  setLoginPassword: (value: string) => void;
  setShowLoginPassword: (value: boolean) => void;
  setAppValidation: (updater: (previous: Record<string, boolean>) => Record<string, boolean>) => void;
  setSelectedAccount: (value: string) => void;
  loginOwner: () => void;
  onCredentialChange: (key: string, value: string | null) => void;
  registerEvolutionWebhook: () => Promise<void>;
  saveAppCredentials: (accountId?: string) => Promise<void>;
}

export function ApplicationCredentialsStep({
  ownerToken,
  loginEmail,
  loginPassword,
  showLoginPassword,
  loggingIn,
  zernioField,
  evolutionUrlField,
  evolutionKeyField,
  evolutionInstanceField,
  openaiField,
  whatsappOk,
  evolutionOk,
  evolutionWebhookUrl,
  registeringHook,
  accountChoices,
  selectedAccount,
  savingApps,
  allAppValid,
  setLoginEmail,
  setLoginPassword,
  setShowLoginPassword,
  setAppValidation,
  setSelectedAccount,
  loginOwner,
  onCredentialChange,
  registerEvolutionWebhook,
  saveAppCredentials,
}: ApplicationCredentialsStepProps) {
  return (
<>
  <h1 className="mb-2 text-[28px] font-semibold text-[#F8FAFC]">APIs da aplicacao</h1>
  <p className="mb-8 text-base leading-[1.6] text-[#94A3B8]">
    Salve as chaves usadas pela ferramenta. Elas ficam criptografadas no seu Supabase.
  </p>
  {!ownerToken ? (
    <div className="rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-5">
      <h2 className="text-base font-semibold text-[#F8FAFC]">Confirme o login do owner</h2>
      <p className="mt-1 text-[13px] leading-5 text-[#94A3B8]">
        Por seguranca, a senha do owner nao foi salva. Entre novamente para autorizar o salvamento das credenciais.
      </p>
      <div className="mt-4 grid gap-3">
        <input
          type="email"
          value={loginEmail}
          onChange={(event) => setLoginEmail(event.target.value)}
          placeholder="email do owner"
          autoComplete="username"
          className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 py-3 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:outline-none focus:shadow-[0_0_20px_rgba(59,130,246,0.2)]"
        />
        <div className="relative">
          <input
            type={showLoginPassword ? 'text' : 'password'}
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            placeholder="senha do owner"
            autoComplete="current-password"
            className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 py-3 pr-10 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8] focus:border-[#3B82F6] focus:outline-none focus:shadow-[0_0_20px_rgba(59,130,246,0.2)]"
          />
          <button
            type="button"
            aria-label={showLoginPassword ? 'Ocultar' : 'Mostrar'}
            onClick={() => setShowLoginPassword(!showLoginPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#F8FAFC]"
          >
            {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <PrimaryButton
          disabled={!loginEmail.trim() || !loginPassword || loggingIn}
          onClick={loginOwner}
        >
          {loggingIn ? 'Entrando...' : 'Entrar'}
        </PrimaryButton>
      </div>
    </div>
  ) : (
    <>
      <p className="mb-4 text-[13px] leading-5 text-[#94A3B8]">
        Configure <strong className="text-[#F8FAFC]">pelo menos um</strong> provedor de
        WhatsApp. Pode preencher as duas — a oficial (Zernio) e a não-oficial (Evolution)
        coexistem.
      </p>
      <WhatsAppProviderCards
        zernioField={zernioField}
        evolutionUrlField={evolutionUrlField}
        evolutionKeyField={evolutionKeyField}
        evolutionInstanceField={evolutionInstanceField}
        onCredentialChange={onCredentialChange}
        onValidationChange={(key, ok) => setAppValidation((prev) => ({ ...prev, [key]: ok }))}
      />
      {/* OpenAI — necessária para embeddings/Whisper */}
      <div className="glass-card mt-4 p-5">
        <div className="mb-3 text-base font-semibold text-[#F8FAFC]">OpenAI (IA)</div>
        <CredentialField
          field={openaiField}
          initialHasValue={false}
          onChange={onCredentialChange}
          onValidationChange={(key, ok) => setAppValidation((prev) => ({ ...prev, [key]: ok }))}
        />
      </div>
      {!whatsappOk ? (
        <p className="mt-3 text-[13px] font-medium text-[#EF4444]">
          {NO_WHATSAPP_PROVIDER_MESSAGE}
        </p>
      ) : null}
      {evolutionOk && evolutionWebhookUrl ? (
        <div className="mt-4 rounded-xl border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.06)] p-5">
          <div className="text-sm font-semibold text-[#F8FAFC]">
            Cadastre este webhook na Evolution
          </div>
          <p className="mt-1 text-[13px] leading-5 text-[#94A3B8]">
            Para as mensagens chegarem ao CRM, registre esta URL como webhook da sua
            instância Evolution. Clique em <strong className="text-[#F8FAFC]">Cadastrar
            automaticamente</strong> ou registre manualmente no painel da instância →
            Webhook, evento “messages”.
          </p>
          <div className="mt-3 flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-xs text-[#F8FAFC]">
              {evolutionWebhookUrl}
            </code>
            <button
              type="button"
              aria-label="Copiar URL do webhook"
              onClick={() => {
                void navigator.clipboard
                  .writeText(evolutionWebhookUrl)
                  .then(() => toast.success('URL do webhook copiada.'))
                  .catch(() => toast.error('Não foi possível copiar — copie manualmente.'));
              }}
              className="rounded-lg border border-[rgba(59,130,246,0.25)] bg-white/[0.03] px-3 py-2 text-sm font-medium text-[#F8FAFC] transition hover:border-[#3B82F6]"
            >
              Copiar
            </button>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={!ownerToken || registeringHook}
              onClick={() => void registerEvolutionWebhook()}
              className="rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {registeringHook ? 'Registrando…' : 'Cadastrar automaticamente'}
            </button>
          </div>
        </div>
      ) : null}
      <p className="mt-3 text-[13px] text-[#94A3B8]">
        Provider de LLM e chave alternativa ficam em Configurações →
        Credenciais (Configurações Avançadas). Sem isso, a IA usa OpenAI por padrão.
      </p>
      {accountChoices ? (
        <div className="mt-6 rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-5">
          <h2 className="text-base font-semibold text-[#F8FAFC]">Escolha a conta WhatsApp</h2>
          <p className="mt-1 text-[13px] leading-5 text-[#94A3B8]">
            Sua Zernio API Key tem mais de uma conta. Selecione qual numero esta instancia vai operar.
          </p>
          <div className="mt-4 space-y-2">
            {accountChoices.map((acc) => (
              <label
                key={acc.id}
                className={[
                  'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition',
                  selectedAccount === acc.id
                    ? 'border-[#3B82F6] bg-[rgba(59,130,246,0.08)]'
                    : 'border-[rgba(59,130,246,0.2)] bg-white/[0.02] hover:border-[#3B82F6]',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="zernio-account"
                  value={acc.id}
                  checked={selectedAccount === acc.id}
                  onChange={() => setSelectedAccount(acc.id)}
                  className="accent-[#3B82F6]"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-[#F8FAFC]">{acc.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-[#94A3B8]">{acc.id}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <PrimaryButton
              disabled={!selectedAccount || savingApps}
              onClick={() => saveAppCredentials(selectedAccount)}
            >
              {savingApps ? 'Conectando...' : 'Conectar conta'}
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <div className="mt-8 flex justify-end">
          <PrimaryButton disabled={!allAppValid || savingApps} onClick={() => saveAppCredentials()}>
            {savingApps ? 'Conectando...' : 'Salvar e conectar'}
          </PrimaryButton>
        </div>
      )}
    </>
  )}
</>
  );
}
