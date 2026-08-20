import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TriangleAlert, X } from 'lucide-react';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { ADMIN_ROLES } from '@/app/providers/AppUserProvider';
import { useMissingCredentials } from '@/hooks/useMissingCredentials';

// Aviso de setup incompleto (instância recém-instalada ou meio configurada).
// Tom âmbar de aviso — não é `--color-error`, porque nada quebrou; é só um
// empurrão pra terminar a configuração. Dispensável por sessão (reaparece no
// próximo login até a credencial realmente ser salva).
export function CredentialsBanner() {
  const { role } = useAppUser();
  const { loading, missingWhatsApp, missingLLM } = useMissingCredentials();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || loading) return null;
  if (!role || !ADMIN_ROLES.includes(role)) return null;
  if (!missingWhatsApp && !missingLLM) return null;

  const messages: string[] = [];
  if (missingWhatsApp) {
    messages.push('nenhum provedor de WhatsApp (Zernio ou Evolution) foi conectado');
  }
  if (missingLLM) {
    messages.push('nenhuma chave de LLM foi configurada para o agente de IA');
  }

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-xl border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-4 py-3"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#F59E0B]" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-[var(--color-text-primary)]">
          Configuração pendente
        </p>
        <p className="mt-0.5 text-[var(--color-text-secondary)]">
          Sua instância ainda está incompleta: {messages.join(' e ')}.{' '}
          <Link
            to="/settings/profile"
            className="font-medium text-[#F59E0B] underline underline-offset-2 hover:text-[#FBBF24]"
          >
            Ir para Configurações → Credenciais
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dispensar aviso"
        className="shrink-0 rounded-md p-1 text-[var(--color-text-secondary)] transition-colors hover:bg-white/5 hover:text-[var(--color-text-primary)]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
