// Thin provider-dispatch layer so Edge Functions can ask for a JSON-shaped
// completion without caring which LLM vendor the tenant selected.
//
// Each branch returns raw `content` (string). The caller parses JSON if it
// asked for JSON mode; if the model slipped in markdown fences we strip them.

export type LLMProvider = 'openai' | 'claude' | 'gemini';

export interface LLMCallInput {
  provider: LLMProvider;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  // Modelo escolhido pelo usuário (atualmente só usado no provider OpenAI;
  // claude/gemini mantêm o default da casa).
  model?: string;
  // URL pública da imagem recebida do contato (messages.media_url), quando a
  // mensagem que disparou o agente é do tipo 'image'. Buscada e convertida
  // para base64 uma única vez em callLLM() e repassada a cada provider no
  // formato que a respectiva API espera — os três (OpenAI, Claude, Gemini)
  // suportam blocos de imagem inline na chamada de chat.
  imageUrl?: string;
}

export interface LLMCallResult {
  content: string;
  model: string;
}

interface InlineImage {
  mimeType: string;
  base64: string;
}

// Baixa a imagem do media_url (URL pública do Zernio) e converte para
// base64. Encoding em chunks de 32KB para não estourar o limite de
// argumentos de String.fromCharCode em imagens grandes. Retorna null (em
// vez de lançar) para que uma falha no download não derrube a resposta da
// IA inteira — ela segue só sem a imagem.
async function fetchImageAsBase64(url: string): Promise<InlineImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    const bytes = new Uint8Array(await res.arrayBuffer());
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { mimeType, base64: btoa(binary) };
  } catch {
    return null;
  }
}

export async function callLLM(input: LLMCallInput): Promise<LLMCallResult> {
  const image = input.imageUrl ? await fetchImageAsBase64(input.imageUrl) : null;
  switch (input.provider) {
    case 'openai':
      return callOpenAI(input, image);
    case 'claude':
      return callClaude(input, image);
    case 'gemini':
      return callGemini(input, image);
  }
}

async function callOpenAI(input: LLMCallInput, image: InlineImage | null): Promise<LLMCallResult> {
  const model = input.model?.trim() || 'gpt-4.1-mini';
  // Com imagem, o content do turno 'user' vira um array de blocos (texto +
  // image_url) — formato Chat Completions para modelos com visão (gpt-4.1*,
  // gpt-4o*). data: URI evita um segundo fetch da Meta/Zernio pelo lado da OpenAI.
  const userContent = image
    ? [
        { type: 'text', text: input.userPrompt },
        { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
      ]
    : input.userPrompt;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: input.temperature ?? 0.7,
      max_tokens: input.maxTokens ?? 1500,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: userContent },
      ],
      ...(input.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }
  const body = await res.json();
  return { content: body.choices?.[0]?.message?.content ?? '', model };
}

async function callClaude(input: LLMCallInput, image: InlineImage | null): Promise<LLMCallResult> {
  // Defaults to the current best all-rounder per Anthropic's lineup.
  const model = 'claude-sonnet-4-6';
  // Claude Messages API: blocos de conteúdo no turno 'user', imagem em base64
  // (source.type='base64') — evita depender do provider conseguir baixar a
  // URL do Zernio por conta própria.
  const userContent = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } },
        { type: 'text', text: input.userPrompt },
      ]
    : input.userPrompt;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: input.maxTokens ?? 1500,
      temperature: input.temperature ?? 0.7,
      system: input.systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude ${res.status}: ${err}`);
  }
  const body = await res.json();
  // Claude returns an array of content blocks; the first text block is what we want.
  const text =
    Array.isArray(body.content)
      ? body.content.find((c: { type: string }) => c.type === 'text')?.text ?? ''
      : '';
  return { content: text, model };
}

async function callGemini(input: LLMCallInput, image: InlineImage | null): Promise<LLMCallResult> {
  const model = 'gemini-1.5-flash-latest';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
  // Gemini aceita imagem inline via inlineData (base64) num part junto do
  // texto, no mesmo `contents[0].parts`.
  const parts = image
    ? [{ text: input.userPrompt }, { inlineData: { mimeType: image.mimeType, data: image.base64 } }]
    : [{ text: input.userPrompt }];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: input.temperature ?? 0.7,
        maxOutputTokens: input.maxTokens ?? 1500,
        ...(input.json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }
  const body = await res.json();
  const text =
    body.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  return { content: text, model };
}

/**
 * Some models wrap JSON in ```json fences or prose; strip that and parse.
 */
export function parseJsonContent<T>(raw: string): T {
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) cleaned = fence[1].trim();
  return JSON.parse(cleaned) as T;
}
