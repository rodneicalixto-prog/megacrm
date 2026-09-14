import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, MailCheck, QrCode, ShieldAlert } from 'lucide-react';
import { AuthShell } from '../auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/app/providers/AuthProvider';
import { getSupabase } from '@/lib/supabase';

interface PendingConnection {
  id: string;
  instance: string;
  label: string;
}

async function inviteErrorMessage(error: unknown, data: { error?: string } | null): Promise<string> {
  if (data?.error) return data.error;
  const response = (error as { context?: Response } | null)?.context;
  if (response && typeof response.json === 'function') {
    try {
      const body = await response.json() as { error?: string };
      if (body.error) return body.error;
    } catch {
      // FunctionsHttpError sem corpo JSON.
    }
  }
  return (error as { message?: string } | null)?.message ?? 'Convite inválido ou expirado.';
}

// ----------------------------------------------------------------------------
// Invite — aceite de convite nativo do Supabase.
// ----------------------------------------------------------------------------
// O owner convida via `invite-team-member` → o Supabase envia o e-mail de
// convite (inviteUserByEmail). O link do e-mail aponta para esta tela com a
// sessão já estabelecida (detectSessionInUrl). O usuário convidado apenas
// define a senha pela Edge Function accept-team-invite — o app_user com o role
// correto já foi criado pelo trigger handle_new_user no momento do convite.
// O link continua sendo do Supabase Auth, mas o aceite da aplicação tem claim
// atômico próprio para impedir replay e concorrência.
// ----------------------------------------------------------------------------

export default function InvitePage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fila de linhas pessoais a conectar, devolvida por accept-team-invite.
  // Só existe pra supervisor/operator com cargo+instância cadastrados no
  // convite — é o momento certo pro QR porque é a própria pessoa, com o
  // celular em mãos, quem está na tela.
  const [pendingConnections, setPendingConnections] = useState<PendingConnection[]>([]);
  const [qrIndex, setQrIndex] = useState(0);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const currentConnection = pendingConnections[qrIndex] ?? null;

  const loadQr = async (connection: PendingConnection) => {
    setQrLoading(true);
    setQrImage(null);
    setPairingCode(null);
    setQrError(null);
    try {
      const { data: sessionData } = await getSupabase().auth.getSession();
      const response = await fetch('/api/evolution-instance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ connectionId: connection.id }),
      });
      const result = await response.json() as {
        success?: boolean;
        message?: string;
        qr_image?: string | null;
        pairing_code?: string | null;
      };
      if (!response.ok || !result.success) {
        setQrError(result.message ?? 'Não foi possível gerar o QR Code.');
        return;
      }
      setQrImage(result.qr_image ?? null);
      setPairingCode(result.pairing_code ?? null);
      if (!result.qr_image && !result.pairing_code) {
        setQrError('A Evolution não retornou um QR Code. Tente gerar novamente.');
      }
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Erro interno ao gerar o QR Code.');
    } finally {
      setQrLoading(false);
    }
  };

  const finishInvite = async () => {
    setFinishing(true);
    const supabase = getSupabase();
    // Revoga a sessão nascida do link do e-mail só agora — antes disso o
    // token ainda era necessário pra gerar o(s) QR(s) acima.
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (token) {
      const { error } = await supabase.functions.invoke('finalize-team-invite');
      if (error) console.error('finalize-team-invite error', error);
    }
    await supabase.auth.signOut({ scope: 'local' });
    setFinishing(false);
    toast.success('Conta ativada. Entre com a senha que você acabou de criar.');
    navigate('/auth/login', { replace: true });
  };

  const handleNextConnection = () => {
    if (qrIndex + 1 < pendingConnections.length) {
      const next = qrIndex + 1;
      setQrIndex(next);
      void loadQr(pendingConnections[next]);
    } else {
      void finishInvite();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      toast.error('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      toast.error('As senhas não coincidem.');
      return;
    }

    setSubmitting(true);
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('accept-team-invite', {
      body: { password },
    });
    setSubmitting(false);
    if (error || !data?.ok) {
      const message = await inviteErrorMessage(error, data);
      toast.error('Não foi possível aceitar o convite', { description: message });
      return;
    }

    const pending = (data.pending_connections ?? []) as PendingConnection[];
    if (pending.length > 0) {
      setPendingConnections(pending);
      setQrIndex(0);
      void loadQr(pending[0]);
      return;
    }
    void finishInvite();
  };

  if (currentConnection) {
    return (
      <AuthShell
        title="Conecte seu WhatsApp"
        subtitle={`Linha ${currentConnection.label} (${qrIndex + 1} de ${pendingConnections.length})`}
      >
        <div className="flex flex-col items-center gap-4">
          <p className="text-center text-sm text-[var(--color-text-secondary)]">
            No WhatsApp do seu celular, abra Aparelhos conectados, escolha Conectar
            aparelho e leia o QR Code abaixo.
          </p>
          <div className="flex min-h-64 w-full items-center justify-center">
            {qrLoading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <Loader2 className="h-5 w-5 animate-spin" /> Gerando QR Code…
              </div>
            ) : qrImage ? (
              <img src={qrImage} alt={`QR Code da instância ${currentConnection.instance}`} className="h-64 w-64 bg-white p-2" />
            ) : pairingCode ? (
              <div className="text-center">
                <div className="text-xs uppercase text-[var(--color-text-secondary)]">Código de pareamento</div>
                <code className="mt-2 block text-2xl font-semibold tracking-[0.12em] text-[var(--color-text-primary)]">
                  {pairingCode}
                </code>
              </div>
            ) : (
              <p className="max-w-sm text-center text-sm text-[var(--color-error)]">
                {qrError ?? 'QR Code indisponível.'}
              </p>
            )}
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadQr(currentConnection)}
              disabled={qrLoading || finishing}
            >
              <QrCode className="h-4 w-4" /> Gerar novo QR
            </Button>
            <Button type="button" onClick={handleNextConnection} disabled={qrLoading || finishing}>
              {finishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Finalizando...
                </>
              ) : qrIndex + 1 < pendingConnections.length ? (
                'Já conectei, próxima linha'
              ) : (
                'Já conectei, entrar'
              )}
            </Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (loading) {
    return (
      <AuthShell title="Aceitar convite" subtitle="Validando seu convite...">
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-primary)]" />
        </div>
      </AuthShell>
    );
  }

  // Sem sessão = o link não foi aberto a partir do e-mail de convite, ou já
  // expirou / foi consumido.
  if (!session) {
    return (
      <AuthShell
        title="Convite inválido"
        subtitle="O link parece estar incorreto ou expirado."
        footer={
          <>
            Já tem conta?{' '}
            <Link
              to="/auth/login"
              className="text-[var(--accent-primary)] hover:underline font-medium"
            >
              Entrar
            </Link>
          </>
        }
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <ShieldAlert className="h-12 w-12 text-[var(--color-error)]" />
          <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
            Abra o link diretamente do e-mail de convite. Se já passou da validade,
            peça um novo convite ao owner desta instância.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Aceitar convite"
      subtitle="Defina sua senha para acessar a instância."
      footer={
        <>
          Já tem conta?{' '}
          <Link
            to="/auth/login"
            className="text-[var(--accent-primary)] hover:underline font-medium"
          >
            Entrar
          </Link>
        </>
      }
    >
      <div className="flex justify-center mb-2">
        <MailCheck className="h-10 w-10 text-[var(--accent-primary)]" />
      </div>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="invite-email">E-mail</Label>
          <Input
            id="invite-email"
            type="email"
            value={session.user.email ?? ''}
            readOnly
            disabled
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={submitting}
            minLength={8}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm">Confirmar senha</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            disabled={submitting}
            minLength={8}
          />
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Ativando...
            </>
          ) : (
            <>Definir senha e entrar</>
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
