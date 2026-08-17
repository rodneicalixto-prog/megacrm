import { CredentialField } from '@/components/credentials/CredentialField';
import type { CredentialField as CredentialFieldConfig } from '../../../setup.config';

type Props = {
  zernioField: CredentialFieldConfig;
  evolutionUrlField: CredentialFieldConfig;
  evolutionKeyField: CredentialFieldConfig;
  evolutionInstanceField: CredentialFieldConfig;
  uazapiUrlField: CredentialFieldConfig;
  uazapiKeyField: CredentialFieldConfig;
  uazapiInstanceField: CredentialFieldConfig;
  onCredentialChange: (key: string, value: string | null) => void;
  onValidationChange: (key: string, isValid: boolean) => void;
};

// As duas rotas são individualmente opcionais (a regra "pelo menos uma" fica
// no SetupPage) — o badge deixa isso explícito nos dois cards.
function OptionalBadge() {
  return (
    <span className="rounded-full border border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#60A5FA]">
      Opcional
    </span>
  );
}

// Step 4 do wizard: as duas rotas de WhatsApp. Ambas individualmente
// opcionais; a regra "pelo menos uma" é aplicada por quem renderiza (SetupPage).
export function WhatsAppProviderCards({
  zernioField,
  evolutionUrlField,
  evolutionKeyField,
  evolutionInstanceField,
  uazapiUrlField,
  uazapiKeyField,
  uazapiInstanceField,
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

      {/* Card 2 — API Não Oficial (Evolution API, self-hosted) */}
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

      {/* Card 3 — UAZAPI (Baileys/WebSocket) */}
      <div className="glass-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-base font-semibold text-[#F8FAFC]">UAZAPI</span>
          <OptionalBadge />
        </div>
        <p className="mb-3 text-[13px] leading-5 text-[#94A3B8]">
          Canal não-oficial com espelhamento no celular: conversas continuam visíveis
          no WhatsApp mobile e no CRM, com envio/recebimento de áudio, vídeo, imagem
          e documentos.
        </p>
        <div className="space-y-3">
          <CredentialField
            field={uazapiUrlField}
            initialHasValue={false}
            onChange={onCredentialChange}
            onValidationChange={onValidationChange}
          />
          <CredentialField
            field={uazapiKeyField}
            initialHasValue={false}
            onChange={onCredentialChange}
            onValidationChange={onValidationChange}
          />
          <CredentialField
            field={uazapiInstanceField}
            initialHasValue={false}
            onChange={onCredentialChange}
            onValidationChange={onValidationChange}
          />
        </div>
      </div>
    </div>
  );
}
