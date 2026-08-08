import { CredentialField } from '@/components/credentials/CredentialField';
import type { CredentialField as CredentialFieldConfig } from '../../../setup.config';

type Props = {
  zernioField: CredentialFieldConfig;
  uazapiUrlField: CredentialFieldConfig;
  uazapiTokenField: CredentialFieldConfig;
  evolutionUrlField: CredentialFieldConfig;
  evolutionKeyField: CredentialFieldConfig;
  evolutionInstanceField: CredentialFieldConfig;
  onCredentialChange: (key: string, value: string | null) => void;
  onValidationChange: (key: string, isValid: boolean) => void;
};

// Todos os provedores são individualmente opcionais (a regra "pelo menos um"
// fica no SetupPage) — o badge deixa isso explícito em cada card.
function OptionalBadge() {
  return (
    <span className="rounded-full border border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#60A5FA]">
      Opcional
    </span>
  );
}

// Step 4 do wizard: os provedores de WhatsApp. Todos individualmente
// opcionais; a regra "pelo menos um" é aplicada por quem renderiza (SetupPage).
export function WhatsAppProviderCards({
  zernioField,
  uazapiUrlField,
  uazapiTokenField,
  evolutionUrlField,
  evolutionKeyField,
  evolutionInstanceField,
  onCredentialChange,
  onValidationChange,
}: Props) {
  return (
    <div className="space-y-4">
      {/* Card 1 — API Oficial (Zernio) */}
      <div className="glass-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-base font-semibold text-[#F8FAFC]">API Oficial do WhatsApp</span>
          <OptionalBadge />
        </div>
        <p className="mb-3 text-[13px] leading-5 text-[#94A3B8]">
          Insira a Zernio API Key. Atribuição automática via Click-to-WhatsApp (ctwa_clid) e
          conformidade Meta.
        </p>
        <CredentialField
          field={zernioField}
          initialHasValue={false}
          onChange={onCredentialChange}
          onValidationChange={onValidationChange}
        />
      </div>

      {/* Card 2 — API Não Oficial (Uazapi) */}
      <div className="glass-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-base font-semibold text-[#F8FAFC]">API Não Oficial do WhatsApp</span>
          <OptionalBadge />
        </div>
        <p className="mb-3 text-[13px] leading-5 text-[#94A3B8]">
          Insira a URL Server e o Instance Token da Uazapi. Caminho acessível; atribuição via código
          de rastreio.
        </p>
        <div className="space-y-3">
          <CredentialField
            field={uazapiUrlField}
            initialHasValue={false}
            onChange={onCredentialChange}
            onValidationChange={onValidationChange}
          />
          <CredentialField
            field={uazapiTokenField}
            initialHasValue={false}
            onChange={onCredentialChange}
            onValidationChange={onValidationChange}
          />
        </div>
      </div>

      {/* Card 3 — API Não Oficial (Evolution API, self-hosted) */}
      <div className="glass-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-base font-semibold text-[#F8FAFC]">Evolution API</span>
          <OptionalBadge />
        </div>
        <p className="mb-3 text-[13px] leading-5 text-[#94A3B8]">
          Informe a URL do servidor, a API Key e o nome da instância da sua Evolution API v2.
          Self-hosted; atribuição via código de rastreio.
        </p>
        <div className="space-y-3">
          <CredentialField
            field={evolutionUrlField}
            initialHasValue={false}
            onChange={onCredentialChange}
            onValidationChange={onValidationChange}
          />
          <CredentialField
            field={evolutionKeyField}
            initialHasValue={false}
            onChange={onCredentialChange}
            onValidationChange={onValidationChange}
          />
          <CredentialField
            field={evolutionInstanceField}
            initialHasValue={false}
            onChange={onCredentialChange}
            onValidationChange={onValidationChange}
          />
        </div>
      </div>
    </div>
  );
}
