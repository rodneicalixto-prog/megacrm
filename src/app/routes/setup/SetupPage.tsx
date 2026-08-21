import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@supabase/supabase-js';
import { setupConfig } from '../../../../setup.config';
import {
  hasAtLeastOneWhatsAppProvider,
  hasEvolutionProvider,
} from './whatsappProviders';

import { SetupCard, StepIndicator } from './SetupChrome';
import { BootstrapStep, CredentialsStep, PreparationStep, type TimelineStep } from './SetupCoreSteps';
import { ApplicationCredentialsStep } from './ApplicationCredentialsStep';
import {
  readSavedCore,
  STORAGE_KEY,
  validateCoreField,
  type CoreValues,
  type FieldKey,
  type Step,
  type ValidationMap,
} from './setupCore';

// Each Step 3 row maps to the checkpoint that api/bootstrap.ts writes into
// public._bootstrap_state. The wizard hydrates the timeline from those rows so
// a refresh mid-bootstrap shows the real progress instead of restarting blind.
// The final row ('app_live') is NOT a _bootstrap_state checkpoint — it is only
// completed once the health probe confirms the redeploy is live with envs.
const TIMELINE_STEPS: TimelineStep[] = [
  { label: 'Conectando ao Supabase', key: 'connection_ok' },
  { label: 'Rodando migrations', key: 'migrations_done' },
  { label: 'Deployando Edge Functions', key: 'edge_functions_deployed' },
  { label: 'Criando conta de administrador', key: 'owner_created' },
  { label: 'Configurando Vercel', key: 'vercel_envs_set' },
  { label: 'Disparando redeploy', key: 'redeploy_triggered' },
  { label: 'Aguardando aplicacao reiniciar', key: 'app_live' },
];

const HEALTH_POLL_INTERVAL_MS = 4000;
const HEALTH_POLL_TIMEOUT_MS = 5 * 60 * 1000;


export default function SetupPage() {
  // Reexecução: o wizard foi aberto de propósito numa instalação já
  // configurada, para reaplicar migrations e redeployar as Edge Functions.
  // Lido antes de tudo porque o estado inicial do passo depende dele.
  const isRerun = new URLSearchParams(window.location.search).get('rerun') === '1';
  const [core, setCore] = useState<CoreValues>(readSavedCore);

  const [step, setStep] = useState<Step>(() => {
    const value = new URLSearchParams(window.location.search).get('step');
    if (value !== '3' && value !== '4') return 1;
    // Sem as credenciais core nao da para retomar: volta ao inicio.
    const saved = readSavedCore();
    if (!saved.supabase_url || !saved.supabase_pat) return 1;
    // Passo 4 monta o client do navegador, que exige a anon key. Uma
    // reexecucao nao coleta esse campo, entao chegar la — por deep link ou por
    // localStorage pela metade — quebra com "supabaseKey is required" numa tela
    // que a reexecucao nem precisa. Volta ao inicio em vez de entrar num ciclo
    // entre os passos 3 e 4.
    if (value === '4' && (isRerun || !saved.supabase_anon_key)) return 1;
    return value === '4' ? 4 : 3;
  });
  const [validation, setValidation] = useState<ValidationMap>({});
  // A core field is validated only after the user interacts with it, so a
  // pristine Step 2 never shows red errors before any input. Fields restored
  // from localStorage already carry a value, so we treat them as touched to
  // keep the returning-user flow (auto-validate + enable Configurar) intact.
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>(() =>
    Object.fromEntries(
      (Object.keys(core) as FieldKey[])
        .filter((key) => core[key].trim() !== '')
        .map((key) => [key, true]),
    ),
  );
  const [bootstrapping, setBootstrapping] = useState(false);
  const [timeline, setTimeline] = useState<string[]>([]);
  const [appCredentials, setAppCredentials] = useState<Record<string, string>>({});
  const [appValidation, setAppValidation] = useState<Record<string, boolean>>({});
  const [savingApps, setSavingApps] = useState(false);
  const [registeringHook, setRegisteringHook] = useState(false);
  const [evolutionWebhookUrl, setEvolutionWebhookUrl] = useState('');
  // Zernio pode ter mais de uma conta WhatsApp sob a mesma API Key; quando
  // zernio-connect responde needsSelection, o wizard mostra o seletor abaixo.
  const [accountChoices, setAccountChoices] = useState<{ id: string; name: string }[] | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [showCorePassword, setShowCorePassword] = useState<Record<FieldKey, boolean>>(
    {} as Record<FieldKey, boolean>,
  );
  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState(() => core.owner_email);
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [waitingForApp, setWaitingForApp] = useState(false);
  const [deployTimedOut, setDeployTimedOut] = useState(false);
  const pollingRef = useRef(false);

  useEffect(() => {
    const safe = { ...core, owner_password: '' };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  }, [core]);

  useEffect(() => {
    if (step !== 2) return;
    const timers = Object.entries(core).map(([key, value]) =>
      window.setTimeout(async () => {
        const field = key as FieldKey;
        if (!touched[field]) return;
        const v = value.trim();
        let result = { ok: true, message: '' };
        if (field === 'supabase_url') {
          result = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(v)
            ? { ok: true, message: 'URL valida.' }
            : { ok: false, message: 'Use https://xxxxx.supabase.co' };
        } else if (field === 'supabase_anon_key' || field === 'supabase_service_role_key') {
          result = v && core.supabase_url
            ? await validateCoreField(field, v, { supabase_url: core.supabase_url })
            : { ok: false, message: 'Preencha URL e chave.' };
        } else if (field === 'supabase_pat') {
          result = v
            ? await validateCoreField(field, v, {})
            : { ok: false, message: 'Informe o PAT.' };
        } else if (field === 'vercel_token') {
          result = v
            ? await validateCoreField(field, v, {})
            : { ok: false, message: 'Informe o token Vercel.' };
        } else if (field === 'owner_email') {
          result = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
            ? { ok: true, message: 'Email valido.' }
            : { ok: false, message: 'Email invalido.' };
        } else if (field === 'owner_password') {
          result = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(v)
            ? { ok: true, message: 'Senha valida.' }
            : { ok: false, message: 'Minimo 8 caracteres, com letra e numero.' };
        }
        setValidation((prev) => ({ ...prev, [field]: result }));
      }, 800),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [core, step, touched]);

  // Reexecucao nao cria dono nem reconfigura a Vercel: pedir os sete campos
  // obrigava a gerar token de deploy e relembrar a senha do dono so para
  // reaplicar uma migration.
  const requiredFields = useMemo<FieldKey[]>(
    () =>
      isRerun
        ? ['supabase_url', 'supabase_service_role_key', 'supabase_pat']
        : [
            'supabase_url',
            'supabase_anon_key',
            'supabase_service_role_key',
            'supabase_pat',
            'vercel_token',
            'owner_email',
            'owner_password',
          ],
    [isRerun],
  );

  const coreReady = useMemo(
    () => requiredFields.every((key) => validation[key]?.ok),
    [validation, requiredFields],
  );

  // The redeploy that api/bootstrap fires only activates the core envs in a NEW
  // deployment. We poll the app's own /api/health (same-origin, no VERCEL_TOKEN)
  // until it reports 200 — meaning process.env.SUPABASE_URL is live — before
  // advancing to Step 4, whose API Routes need those envs. Without this gate
  // Step 4 races the redeploy and /api/credentials returns 500.
  const waitForAppLive = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    setWaitingForApp(true);
    setDeployTimedOut(false);
    setTimeline(TIMELINE_STEPS.slice(0, 6).map((entry) => entry.label));
    const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
    try {
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${window.location.origin}/api/health`, { cache: 'no-store' });
          if (res.ok) {
            setTimeline(TIMELINE_STEPS.map((entry) => entry.label));
            window.location.href = '/setup?step=4&r=' + Date.now();
            return;
          }
        } catch {
          // Network blips are expected while the production alias swaps over.
        }
        await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
      }
      setDeployTimedOut(true);
    } finally {
      setWaitingForApp(false);
      pollingRef.current = false;
    }
  }, []);

  // On (re)entering Step 3 while not actively bootstrapping — e.g. after a
  // refresh — read public._bootstrap_state and reflect completed checkpoints in
  // the timeline so the user sees where the run stopped. If the redeploy was
  // already triggered, resume polling for the app to come live.
  useEffect(() => {
    if (step !== 3 || bootstrapping) return;
    // Reexecucao nunca dispara redeploy da Vercel. Reaproveitar aqui o
    // checkpoint historico `redeploy_triggered` da instalacao inicial criava um
    // loop Step 3 -> Step 4 -> Step 3 depois de aplicar uma atualizacao.
    if (isRerun) return;
    if (!core.supabase_url || !core.supabase_pat) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/bootstrap-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supabase_url: core.supabase_url, supabase_pat: core.supabase_pat }),
        });
        const body = (await res.json()) as { completed?: string[] };
        if (cancelled || !Array.isArray(body.completed)) return;
        const done = new Set(body.completed);
        setTimeline(
          TIMELINE_STEPS.filter((entry) => done.has(entry.key)).map((entry) => entry.label),
        );
        if (done.has('redeploy_triggered')) void waitForAppLive();
      } catch {
        // Leave the timeline empty; the user can still retry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, bootstrapping, core.supabase_url, core.supabase_pat, isRerun, waitForAppLive]);

  const runBootstrap = async () => {
    setStep(3);
    // Keep ?step=3 in the URL so a refresh mid-bootstrap returns here (and
    // re-hydrates from _bootstrap_state) instead of bouncing back to Step 1.
    window.history.replaceState(null, '', isRerun ? '/setup?step=3&rerun=1' : '/setup?step=3');
    setBootstrapping(true);
    setDeployTimedOut(false);
    setTimeline(['Conectando ao Supabase']);
    try {
      const payload = isRerun
        ? {
            supabase_url: core.supabase_url,
            supabase_service_role_key: core.supabase_service_role_key,
            supabase_pat: core.supabase_pat,
            update_only: true,
          }
        : core;
      const res = await fetch('/api/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.message ?? 'Bootstrap falhou.');
      if (isRerun) {
        // Sem redeploy nao ha o que esperar: as envs ja estao vivas e o Step 4
        // (credenciais de aplicacao) nao faz parte de uma reexecucao. Devolve
        // ao app: parado aqui, o proximo clique cai numa tela que a reexecucao
        // nao tem como preencher.
        setTimeline(TIMELINE_STEPS.slice(0, 3).map((entry) => entry.label));
        toast.success('Atualizacoes aplicadas.');
        // URL, service role e PAT sao segredos temporarios de bootstrap. A
        // reexecucao termina no app e deve remove-los mesmo sem passar pelo
        // Step 4 do fluxo de primeira instalacao.
        window.localStorage.removeItem(STORAGE_KEY);
        window.setTimeout(() => { window.location.href = '/'; }, 1500);
        return;
      }
      toast.success('Bootstrap concluido. Aguardando o app reiniciar...');
      // Don't jump to Step 4 yet — wait for the redeploy to bring the envs live.
      await waitForAppLive();
    } catch (err) {
      toast.error('Bootstrap falhou', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setBootstrapping(false);
    }
  };

  // Step 4 runs after a full-page redirect, so the owner password is already
  // gone from memory/localStorage. We re-ask for it to mint a session token —
  // /api/credentials now requires an admin JWT. persistSession:false keeps this
  // throwaway client from clobbering the main app's auth storage.
  const loginOwner = async () => {
    setLoggingIn(true);
    try {
      const client = createClient(core.supabase_url, core.supabase_anon_key, {
        auth: { persistSession: false },
      });
      const { data, error } = await client.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      if (error || !data.session) throw new Error(error?.message ?? 'Login falhou.');
      setOwnerToken(data.session.access_token);
      setLoginPassword('');
      toast.success('Owner autenticado.');
    } catch (err) {
      toast.error('Falha no login do owner', {
        description: err instanceof Error ? err.message : 'Credenciais invalidas',
      });
    } finally {
      setLoggingIn(false);
    }
  };

  // Salva as chaves no cofre e, em seguida, pede ao servidor que resolva a conta
  // WhatsApp do Zernio (accountId/profileId/tier) e registre o webhook. A Zernio
  // API Key nunca chama o Zernio direto do browser — quem fala com o Zernio e a
  // API Route. `accountId` so e passado no segundo clique, quando ha varias
  // contas e o operador escolheu uma no seletor.
  const saveAppCredentials = async (accountId?: string) => {
    setSavingApps(true);
    try {
      const creds: Record<string, string> = { ...appCredentials };
      if (!(creds.llm_provider ?? '').trim()) creds.llm_provider = 'openai';

      const saveRes = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken ?? ''}`,
        },
        body: JSON.stringify({ credentials: creds }),
      });
      const saveBody = await saveRes.json();
      if (!saveRes.ok || !saveBody.success) throw new Error(saveBody.message ?? 'Falha ao salvar.');

      // Evolution-only: sem Zernio não há conta oficial/webhook para resolver.
      // A conexão da rota não-oficial é tratada nas fases de inbound.
      const hasZernio = !!(creds.zernio_api_key ?? '').trim();
      if (!hasZernio) {
        window.localStorage.removeItem(STORAGE_KEY);
        toast.success('Credenciais salvas (Evolution).');
        window.location.href = setupConfig.postBootstrapRedirect;
        return;
      }

      const connectRes = await fetch('/api/zernio-connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken ?? ''}`,
        },
        body: JSON.stringify(accountId ? { accountId } : {}),
      });
      const connectBody = await connectRes.json();

      if (connectRes.ok && connectBody.needsSelection) {
        setAccountChoices(connectBody.accounts ?? []);
        toast.message('Selecione a conta WhatsApp do Zernio para conectar.');
        return;
      }
      if (!connectRes.ok || !connectBody.success) {
        throw new Error(connectBody.message ?? 'Falha ao conectar o WhatsApp via Zernio.');
      }
      if (connectBody.webhookWarning) {
        toast.warning('WhatsApp conectado, mas o webhook nao foi registrado automaticamente.', {
          description: connectBody.webhookWarning,
        });
      }

      window.localStorage.removeItem(STORAGE_KEY);
      const phone = connectBody.number?.display_phone_number as string | undefined;
      toast.success(phone ? `WhatsApp ${phone} conectado.` : 'Credenciais salvas.');
      window.location.href = setupConfig.postBootstrapRedirect;
    } catch (err) {
      toast.error('Falha ao salvar credenciais', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setSavingApps(false);
    }
  };

  // Cadastro automático do webhook na Evolution, direto do wizard (mesma ação
  // de Configurações → Credenciais). Como o /api/evolution-status lê as
  // credenciais do app_settings via getCredential, primeiro persistimos server
  // URL + API key + instance; só então a Evolution consegue registrar o webhook.
  const registerEvolutionWebhook = async () => {
    setRegisteringHook(true);
    try {
      const evolutionCreds: Record<string, string> = {};
      const serverUrl = (appCredentials.evolution_server_url ?? '').trim();
      const apiKey = (appCredentials.evolution_api_key ?? '').trim();
      const instance = (appCredentials.evolution_instance ?? '').trim();
      if (serverUrl) evolutionCreds.evolution_server_url = serverUrl;
      if (apiKey) evolutionCreds.evolution_api_key = apiKey;
      if (instance) evolutionCreds.evolution_instance = instance;

      const saveRes = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken ?? ''}`,
        },
        body: JSON.stringify({ credentials: evolutionCreds }),
      });
      const saveBody = await saveRes.json();
      if (!saveRes.ok || !saveBody.success) {
        throw new Error(saveBody.message ?? 'Falha ao salvar as credenciais da Evolution.');
      }

      const hookRes = await fetch('/api/evolution-status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken ?? ''}` },
      });
      const hookBody = await hookRes.json();
      if (!hookRes.ok || !hookBody.success) {
        throw new Error(hookBody.message ?? 'A Evolution recusou o registro do webhook.');
      }
      if (typeof hookBody.webhook_url === 'string') {
        setEvolutionWebhookUrl(hookBody.webhook_url);
      }
      toast.success('Webhook registrado na Evolution.');
    } catch (err) {
      toast.error('Não foi possível registrar o webhook automaticamente', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setRegisteringHook(false);
    }
  };

  const onCredentialChange = useCallback((key: string, value: string | null) => {
    setAppCredentials((prev) => {
      const next = { ...prev };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);

  // O step 4 coleta: uma rota de WhatsApp (Zernio OU Evolution — pelo menos uma)
  // + OpenAI (embeddings/Whisper). Provider/chave de LLM e App URL ficam em
  // /settings/credentials (o LLM cai no padrão openai usando a OpenAI API Key).
  const fieldByKey = (key: string) =>
    setupConfig.appCredentials.find((f) => f.key === key)!;
  const zernioField = fieldByKey('zernio_api_key');
  const evolutionUrlField = fieldByKey('evolution_server_url');
  const evolutionKeyField = fieldByKey('evolution_api_key');
  const evolutionInstanceField = fieldByKey('evolution_instance');
  const openaiField = fieldByKey('openai_api_key');

  const whatsappOk = hasAtLeastOneWhatsAppProvider(appCredentials, appValidation);
  const evolutionOk = hasEvolutionProvider(appCredentials, appValidation);
  const openaiOk = appValidation['openai_api_key'] === true;
  const allAppValid = whatsappOk && openaiOk;

  return (
    <div className="min-h-screen bg-[#0A0A0F] px-4 py-8 text-[#F8FAFC] md:py-12">
      <div className="mx-auto w-full max-w-[760px]">
        <StepIndicator step={step} />
        <SetupCard>
          {step === 1 ? (
            <PreparationStep isRerun={isRerun} onContinue={() => setStep(2)} />
          ) : null}

          {step === 2 ? (
            <CredentialsStep
              fields={requiredFields}
              core={core}
              validation={validation}
              revealed={showCorePassword}
              ready={coreReady}
              bootstrapping={bootstrapping}
              onChange={(key, value) => {
                setTouched((prev) => ({ ...prev, [key]: true }));
                setCore((prev) => ({ ...prev, [key]: value }));
              }}
              onToggleReveal={(key) => setShowCorePassword((prev) => ({ ...prev, [key]: !prev[key] }))}
              onBack={() => setStep(1)}
              onConfigure={runBootstrap}
            />
          ) : null}

          {step === 3 ? (
            <BootstrapStep
              isRerun={isRerun}
              steps={TIMELINE_STEPS}
              timeline={timeline}
              waiting={waitingForApp}
              timedOut={deployTimedOut}
              bootstrapping={bootstrapping}
              ownerPassword={core.owner_password}
              onOwnerPasswordChange={(value) => setCore((prev) => ({ ...prev, owner_password: value }))}
              onVerifyAgain={() => void waitForAppLive()}
              onContinue={() => { window.location.href = '/setup?step=4&r=' + Date.now(); }}
              onRetry={runBootstrap}
            />
          ) : null}

          {step === 4 ? (
            <ApplicationCredentialsStep
              ownerToken={ownerToken}
              loginEmail={loginEmail}
              loginPassword={loginPassword}
              showLoginPassword={showLoginPassword}
              loggingIn={loggingIn}
              zernioField={zernioField}
              evolutionUrlField={evolutionUrlField}
              evolutionKeyField={evolutionKeyField}
              evolutionInstanceField={evolutionInstanceField}
              openaiField={openaiField}
              whatsappOk={whatsappOk}
              evolutionOk={evolutionOk}
              evolutionWebhookUrl={evolutionWebhookUrl}
              registeringHook={registeringHook}
              accountChoices={accountChoices}
              selectedAccount={selectedAccount}
              savingApps={savingApps}
              allAppValid={allAppValid}
              setLoginEmail={setLoginEmail}
              setLoginPassword={setLoginPassword}
              setShowLoginPassword={setShowLoginPassword}
              setAppValidation={setAppValidation}
              setSelectedAccount={setSelectedAccount}
              loginOwner={loginOwner}
              onCredentialChange={onCredentialChange}
              registerEvolutionWebhook={registerEvolutionWebhook}
              saveAppCredentials={saveAppCredentials}
            />
          ) : null}
        </SetupCard>
      </div>
    </div>
  );
}
