export type CredentialField = {
  key: string;
  label: string;
  helpText?: string;
  docsUrl?: string;
  placeholder?: string;
  inputType?: 'text' | 'password';
  validate: (value: string) => Promise<{ ok: boolean; message?: string }>;
};

export type SetupConfig = {
  toolName: string;
  toolSlug: string;
  appCredentials: CredentialField[];
  postBootstrapRedirect: string;
};

const ok = { ok: true } as const;

async function validateOpenAI(value: string) {
  if (!value.startsWith('sk-')) {
    return { ok: false, message: 'A chave OpenAI deve comecar com sk-.' };
  }
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${value}` },
  });
  return res.ok
    ? ok
    : { ok: false, message: 'Chave OpenAI invalida ou sem permissao.' };
}

async function validateAnthropic(value: string) {
  if (!value.startsWith('sk-ant-')) {
    return { ok: false, message: 'A chave Anthropic deve comecar com sk-ant-.' };
  }
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': value,
      'anthropic-version': '2023-06-01',
    },
  });
  return res.ok
    ? ok
    : { ok: false, message: 'Chave Anthropic invalida ou sem permissao.' };
}

async function validateGemini(value: string) {
  if (!value.startsWith('AIza')) {
    return { ok: false, message: 'A chave Gemini normalmente comeca com AIza.' };
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(value)}`,
  );
  return res.ok
    ? ok
    : { ok: false, message: 'Chave Gemini invalida ou sem permissao.' };
}

// Base da API Zernio. Pode ser sobrescrita por env (testes/staging); cai no
// dominio publico por padrao. Lida server-side (api/validate, api/zernio-connect)
// e tambem aqui no validator de campo, que so roda no servidor.
export const ZERNIO_API_BASE_URL =
  (typeof process !== 'undefined' ? process.env?.ZERNIO_API_BASE_URL : undefined) ||
  'https://zernio.com/api/v1';

async function validateZernio(value: string) {
  const v = value.trim();
  if (!/^sk_[a-f0-9]{64}$/i.test(v)) {
    return {
      ok: false,
      message: 'A chave Zernio deve ter o formato sk_ seguido de 64 caracteres hex.',
    };
  }
  // Ping real: GET /accounts confirma que a chave autentica no Zernio. A
  // resolucao de accountId/profileId/numero acontece no salvar (zernio-connect).
  const res = await fetch(`${ZERNIO_API_BASE_URL}/accounts`, {
    headers: { Authorization: `Bearer ${v}` },
  });
  return res.ok
    ? ok
    : { ok: false, message: 'Chave Zernio invalida ou sem permissao.' };
}

export const setupConfig: SetupConfig = {
  toolName: 'WhatsApp Hub',
  toolSlug: 'whatsapp-hub',
  postBootstrapRedirect: '/dashboard',
  // O aluno conecta o WhatsApp dentro do Zernio (Embedded Signup) e informa
  // apenas a Zernio API Key. accountId/profileId/tier/numero sao resolvidos
  // server-side no salvar (api/zernio-connect). Nada da Meta e coletado aqui.
  appCredentials: [
    {
      key: 'zernio_api_key',
      label: 'Zernio API Key',
      placeholder: 'sk_...',
      inputType: 'password',
      docsUrl: 'https://zernio.com/dashboard/api-keys',
      helpText:
        'Opcional. Atribuicao premium via Click-to-WhatsApp (ctwa_clid) + conformidade Meta. Conecte o WhatsApp no Zernio (Embedded Signup) e cole a API Key; numero, tier e webhook sao configurados automaticamente.',
      validate: validateZernio,
    },
    {
      key: 'evolution_server_url',
      label: 'Evolution Server URL',
      placeholder: 'https://sua-evolution.com',
      inputType: 'text',
      docsUrl: 'https://doc.evolution-api.com',
      helpText:
        'Opcional. URL do seu servidor Evolution API v2 (API nao-oficial, self-hosted).',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok; // opcional
        return /^https:\/\/[^\s]+$/i.test(v)
          ? ok
          : { ok: false, message: 'Informe uma URL HTTPS valida (ex.: https://sua-evolution.com).' };
      },
    },
    {
      key: 'evolution_api_key',
      label: 'Evolution API Key',
      placeholder: 'sua apikey global ou da instancia',
      inputType: 'password',
      helpText:
        'Opcional. Valor enviado no header apikey. Atribuicao via codigo de rastreio (Evolution nao entrega ctwa_clid).',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok; // opcional
        return v.length >= 8 ? ok : { ok: false, message: 'API key muito curta.' };
      },
    },
    {
      key: 'evolution_instance',
      label: 'Evolution Instance',
      placeholder: 'nome-da-instancia',
      inputType: 'text',
      helpText:
        'Opcional. Nome da instancia criada na Evolution (entra na URL dos endpoints de envio).',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok; // opcional
        return /^[\w.-]{1,64}$/.test(v)
          ? ok
          : { ok: false, message: 'Use apenas letras, numeros, ponto, hifen ou underline.' };
      },
    },
    {
      key: 'openai_api_key',
      label: 'OpenAI API Key',
      placeholder: 'sk-...',
      inputType: 'password',
      docsUrl: 'https://platform.openai.com/api-keys',
      helpText: 'Obrigatoria para embeddings e transcricao de audio (Whisper).',
      validate: validateOpenAI,
    },
    {
      key: 'llm_provider',
      label: 'LLM Provider',
      placeholder: 'openai',
      inputType: 'text',
      helpText: 'openai, claude ou gemini. Deixe vazio para usar openai (padrao).',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok; // vazio = padrao openai
        return ['openai', 'claude', 'gemini'].includes(v)
          ? ok
          : { ok: false, message: 'Use openai, claude ou gemini.' };
      },
    },
    {
      key: 'llm_api_key',
      label: 'LLM API Key',
      placeholder: 'sk-...',
      inputType: 'password',
      helpText:
        'Chave do provider de chat. Obrigatoria apenas se o provider nao for OpenAI; com OpenAI, reusa a OpenAI API Key.',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok; // vazio: cai na OpenAI API Key quando provider = openai
        if (v.startsWith('sk-ant-')) return validateAnthropic(v);
        if (v.startsWith('AIza')) return validateGemini(v);
        return validateOpenAI(v);
      },
    },
    {
      key: 'app_url',
      label: 'App URL',
      placeholder: 'https://seu-app.vercel.app',
      inputType: 'text',
      helpText: 'Opcional. URL publica usada em links de convite. Derivada do deploy se vazia.',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok; // opcional
        return /^https:\/\/.+/i.test(v)
          ? ok
          : { ok: false, message: 'Informe uma URL HTTPS publica.' };
      },
    },
    {
      // Token do canal Instagram (via Zernio). Gerenciado pelo card
      // "Canais" em Configuracoes; oculto da lista de Credenciais.
      key: 'instagram_access_token',
      label: 'Instagram Access Token',
      placeholder: 'IG...',
      inputType: 'password',
      helpText: 'Token do Instagram conectado no Zernio. Cifrado no banco (CRYPTO_KEY).',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok; // opcional: sem token = canal desligado
        return v.length >= 8 ? ok : { ok: false, message: 'Token muito curto.' };
      },
    },
    // ---- Reuniões (Google Meet + gravação/resumo via Recall.ai) ----------
    // Uma conta Google ÚNICA e compartilhada entre todos os departamentos —
    // não há OAuth interativo aqui (exigiria uma tela de consentimento
    // publicada e testada ao vivo). O refresh token é gerado uma vez fora do
    // app, via https://developers.google.com/oauthplayground.
    {
      key: 'google_oauth_client_id',
      label: 'Google OAuth Client ID',
      placeholder: '...apps.googleusercontent.com',
      inputType: 'text',
      docsUrl: 'https://console.cloud.google.com/apis/credentials',
      helpText:
        'Opcional (ativa Reuniões). Crie um projeto no Google Cloud, habilite a Calendar API e crie uma credencial OAuth 2.0 (tipo "App da Web").',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok;
        return v.length >= 20 ? ok : { ok: false, message: 'Client ID muito curto.' };
      },
    },
    {
      key: 'google_oauth_client_secret',
      label: 'Google OAuth Client Secret',
      placeholder: 'GOCSPX-...',
      inputType: 'password',
      helpText: 'Opcional. Gerado junto com o Client ID no Google Cloud Console.',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok;
        return v.length >= 10 ? ok : { ok: false, message: 'Client Secret muito curto.' };
      },
    },
    {
      key: 'google_oauth_refresh_token',
      label: 'Google OAuth Refresh Token',
      placeholder: '1//...',
      inputType: 'password',
      docsUrl: 'https://developers.google.com/oauthplayground',
      helpText:
        'Opcional. Gere uma vez no OAuth Playground: nas engrenagens, marque "Use your own OAuth credentials" com o Client ID/Secret acima; escolha o escopo https://www.googleapis.com/auth/calendar; autorize com a conta Gmail fixa que vai organizar as reuniões; copie o refresh token gerado.',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok;
        return v.length >= 15 ? ok : { ok: false, message: 'Refresh token muito curto.' };
      },
    },
    {
      key: 'recall_api_key',
      label: 'Recall.ai API Key',
      placeholder: '...',
      inputType: 'password',
      docsUrl: 'https://www.recall.ai',
      helpText:
        'Opcional. Bot que entra na chamada pra gravar/transcrever automaticamente. Sem esta chave, as reuniões ainda são criadas com link do Meet, só sem gravação/resumo.',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok;
        return v.length >= 10 ? ok : { ok: false, message: 'API key muito curta.' };
      },
    },
    {
      key: 'recall_webhook_secret',
      label: 'Recall.ai Webhook Secret',
      placeholder: 'invente uma string aleatória',
      inputType: 'password',
      helpText:
        'Opcional (só com Recall.ai API Key preenchida). Invente uma string qualquer aqui e cadastre no painel da Recall.ai a URL de webhook: <sua-url-do-supabase>/functions/v1/recall-webhook?token=<esta-string>.',
      validate: async (value) => {
        const v = value.trim();
        if (!v) return ok;
        return v.length >= 8 ? ok : { ok: false, message: 'Use pelo menos 8 caracteres.' };
      },
    },
  ],
};
