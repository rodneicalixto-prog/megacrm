import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, ShieldAlert } from 'lucide-react';
import { AuthShell } from './AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/app/providers/AuthProvider';
import { getSupabase } from '@/lib/supabase';

// ----------------------------------------------------------------------------
// Reset de senha ("esqueci minha senha") — separado de /invite de propósito.
// /invite passa pela Edge Function accept-team-invite, que só funciona para o
// PRIMEIRO aceite (claim_team_invite exige invite_accepted_at IS NULL). Um
// usuário já ativo que esqueceu a senha nunca teria invite_accepted_at NULL,
// então reusar /invite aqui sempre retornava 409 "convite já utilizado".
// Este fluxo usa a sessão de recovery (resetPasswordForEmail → redirectTo
// aqui) direto com supabase.auth.updateUser, sem tocar em app_users/convites.
// ----------------------------------------------------------------------------

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSubmitting(false);
      toast.error('Não foi possível redefinir a senha', { description: error.message });
      return;
    }
    await supabase.auth.signOut({ scope: 'local' });
    setSubmitting(false);
    toast.success('Senha redefinida. Entre com a nova senha.');
    navigate('/auth/login', { replace: true });
  };

  if (loading) {
    return (
      <AuthShell title="Redefinir senha" subtitle="Validando seu link...">
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-primary)]" />
        </div>
      </AuthShell>
    );
  }

  // Sem sessão = o link não foi aberto a partir do e-mail de recuperação, ou
  // já expirou / foi usado.
  if (!session) {
    return (
      <AuthShell
        title="Link inválido"
        subtitle="O link de redefinição parece estar incorreto ou expirado."
        footer={
          <>
            Voltar para{' '}
            <Link
              to="/auth/login"
              className="text-[var(--accent-primary)] hover:underline font-medium"
            >
              o login
            </Link>
          </>
        }
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <ShieldAlert className="h-12 w-12 text-[var(--color-error)]" />
          <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
            Abra o link diretamente do e-mail de redefinição. Se já passou da
            validade, peça um novo em "Esqueci minha senha" na tela de login.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Redefinir senha"
      subtitle="Defina uma nova senha para sua conta."
      footer={
        <>
          Lembrou a senha?{' '}
          <Link
            to="/auth/login"
            className="text-[var(--accent-primary)] hover:underline font-medium"
          >
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="reset-email">E-mail</Label>
          <Input
            id="reset-email"
            type="email"
            value={session.user.email ?? ''}
            readOnly
            disabled
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Nova senha</Label>
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
          <Label htmlFor="confirm">Confirmar nova senha</Label>
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
              Salvando...
            </>
          ) : (
            <>Salvar nova senha</>
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
