// ============================================================================
// extract-legal-intimation
// ----------------------------------------------------------------------------
// Recebe o storage_path de um PDF de intimação já enviado pelo client ao
// bucket privado whatsapp-hub-legal-attachments (caminho de staging
// `_intake/{uuid}-{filename}`, sem processo ainda) e devolve campos
// estruturados pra pré-preencher o formulário de "Novo processo": número,
// prazo, partes, classificação e um rascunho de resumo.
//
// Extração de texto e fallback de OCR são os MESMOS de process-knowledge
// (unpdf + OpenAI Vision quando o PDF é escaneado) — duplicado aqui em vez
// de extraído pra _shared/ porque só há este segundo uso até agora; vira
// candidato a compartilhar se aparecer um terceiro.
//
// Autorização: não é admin-only (supervisor com acesso ao Jurídico também
// cadastra processo) — replica a mesma regra de whatsapp_hub.can_access_legal()
// em TypeScript, porque essa função SQL lê o JWT via auth.jwt()/current_user_role()
// e não pode ser chamada como está pelo client de service role desta função.
// ============================================================================

import { requireCaller, AuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { loadAppCredentials } from '../_shared/tenant-credentials.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { callLLM, parseJsonContent } from '../_shared/llm.ts';
import { extractText, getDocumentProxy, renderPageAsImage } from 'https://esm.sh/unpdf@0.12.1';

const LEGAL_BUCKET = 'whatsapp-hub-legal-attachments';
const OCR_MAX_PAGES = 15;

interface Payload {
  storage_path?: string;
}

interface ExtractedFields {
  case_number: string | null;
  deadline_at: string | null; // ISO date (YYYY-MM-DD) ou null
  deadline_label: string | null;
  opposing_party: string | null;
  court_reference: string | null;
  classification: string | null;
  summary: string;
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Ver process-knowledge/index.ts — mesmo mecanismo e mesma ressalva: NÃO
// VERIFICADO em ambiente real (renderPageAsImage depende de canvas, que pode
// não ter binding nativo no Deno Edge Runtime). Isolado em try/catch.
async function extractPdfViaVisionFallback(openaiKey: string, buffer: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(buffer);
  const numPages = Math.min((doc as { numPages: number }).numPages ?? 0, OCR_MAX_PAGES);
  if (numPages === 0) return '';

  const pageTexts: string[] = [];
  for (let page = 1; page <= numPages; page++) {
    const png = await renderPageAsImage(doc, page, { scale: 2 });
    const base64 = bufferToBase64(png);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0,
        max_tokens: 4000,
        messages: [
          {
            role: 'system',
            content: 'Você transcreve fielmente todo o texto visível em imagens de páginas de PDF, em português quando aplicável. Responda apenas com o texto transcrito, sem comentários nem markdown.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Transcreva o texto desta página (${page}/${numPages}).` },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI vision ${res.status}: ${await res.text()}`);
    const body = await res.json();
    const text: string = body.choices?.[0]?.message?.content ?? '';
    if (text.trim()) pageTexts.push(text.trim());
  }
  return pageTexts.join('\n\n');
}

const EXTRACTION_SYSTEM_PROMPT = `Você lê intimações e notificações jurídicas trabalhistas/administrativas brasileiras e devolve SOMENTE um JSON com os campos abaixo, sem markdown, sem comentários.

{
  "case_number": string ou null — número do processo, formato CNJ se houver (ex.: "0012345-67.2026.5.02.0043"). Para item interno (auditoria, conformidade) sem número judicial, use null.
  "deadline_at": string ou null — data do próximo prazo/audiência mencionado no documento, formato YYYY-MM-DD. Se houver horário, ignore-o aqui.
  "deadline_label": string ou null — o que é esse prazo, curto (ex.: "Audiência de instrução", "Prazo para contestação").
  "opposing_party": string ou null — nome da parte contrária (reclamante/autor), se identificável.
  "court_reference": string ou null — vara/tribunal mencionado (ex.: "TRT-2, 43ª Vara do Trabalho de São Paulo").
  "classification": string ou null — categoria curta do assunto (ex.: "Horas extras e banco de horas", "Verbas rescisórias", "Assédio moral").
  "summary": string — resumo objetivo do que o documento diz, 2 a 4 frases, em português. Nunca vazio — se o documento for pouco claro, descreva o que deu pra entender.
}

Se algum campo não aparecer no texto, use null (exceto summary, que é obrigatório). Não invente número de processo nem datas que não estejam no texto.`;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireCaller(req);
    const admin = getAdminClient();

    const isAdmin = caller.role === 'super_admin' || caller.role === 'admin';
    let allowed = isAdmin;
    if (!allowed && caller.role === 'supervisor') {
      const { data: member } = await admin
        .from('app_users')
        .select('department_id')
        .eq('user_id', caller.userId)
        .maybeSingle();
      const departmentId = (member as { department_id: string | null } | null)?.department_id;
      if (departmentId) {
        const { data: dept } = await admin
          .from('departments')
          .select('grants_legal_access')
          .eq('id', departmentId)
          .maybeSingle();
        allowed = (dept as { grants_legal_access: boolean } | null)?.grants_legal_access === true;
      }
    }
    if (!allowed) return jsonResponse({ ok: false, error: 'Sem acesso ao módulo Jurídico.' }, { status: 403 });

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
    }
    if (!body.storage_path) {
      return jsonResponse({ ok: false, error: 'storage_path é obrigatório.' }, { status: 400 });
    }

    const creds = await loadAppCredentials();
    if (!creds.llm_api_key) {
      return jsonResponse({ ok: false, error: 'Nenhuma credencial de IA configurada em Configurações → Credenciais.' }, { status: 400 });
    }

    const { data: blob, error: dlErr } = await admin.storage.from(LEGAL_BUCKET).download(body.storage_path);
    if (dlErr || !blob) {
      return jsonResponse({ ok: false, error: `Falha ao baixar PDF: ${dlErr?.message ?? 'desconhecido'}` }, { status: 500 });
    }

    const buffer = new Uint8Array(await blob.arrayBuffer());
    let plaintext = '';
    try {
      const doc = await getDocumentProxy(buffer);
      const { text } = await extractText(doc, { mergePages: true });
      plaintext = Array.isArray(text) ? text.join('\n') : text;
    } catch (err) {
      return jsonResponse({ ok: false, error: `Falha ao ler o PDF: ${err instanceof Error ? err.message : String(err)}` }, { status: 422 });
    }

    let usedOcr = false;
    if (plaintext.trim().length < 20) {
      if (!creds.openai_api_key) {
        return jsonResponse({ ok: false, error: 'PDF sem texto selecionável (escaneado) e sem credencial da OpenAI configurada para OCR.' }, { status: 422 });
      }
      try {
        const ocrText = await extractPdfViaVisionFallback(creds.openai_api_key, buffer);
        if (ocrText.trim().length >= 20) {
          plaintext = ocrText;
          usedOcr = true;
        }
      } catch (ocrErr) {
        console.error('extract-legal-intimation ocr fallback failed', JSON.stringify({
          event: 'legal_intimation_ocr_error',
          storage_path: body.storage_path,
          error: ocrErr instanceof Error ? ocrErr.message : String(ocrErr),
        }));
      }
    }

    if (plaintext.trim().length < 20) {
      return jsonResponse({ ok: false, error: 'Não foi possível extrair texto deste PDF (documento escaneado e OCR falhou).' }, { status: 422 });
    }

    // Documento de intimação raramente passa de poucas páginas de texto
    // útil — corta em 12000 chars pra não estourar tokens em casos raros de
    // PDF anexado com processo inteiro.
    const excerpt = plaintext.slice(0, 12000);

    const llmRes = await callLLM({
      provider: creds.llm_provider,
      apiKey: creds.llm_api_key,
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userPrompt: excerpt,
      json: true,
      temperature: 0,
      maxTokens: 700,
    });

    let extracted: ExtractedFields;
    try {
      extracted = parseJsonContent<ExtractedFields>(llmRes.content);
    } catch {
      return jsonResponse({ ok: false, error: 'A IA não devolveu um JSON válido — tente novamente.' }, { status: 502 });
    }

    return jsonResponse({ ok: true, extracted, used_ocr: usedOcr });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    console.error('extract-legal-intimation error', err);
    return jsonResponse({ ok: false, error: 'Erro interno ao processar a intimação.' }, { status: 500 });
  }
});
