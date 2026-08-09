// Pos-processamento da resposta do LLM, antes de ela virar mensagem no
// WhatsApp. Tudo aqui e puro: entra texto do modelo, sai o que o contato ve
// mais as decisoes que a ferramenta toma.
//
// Estava embutido no process-ai-message, junto com o I/O. Separado porque e a
// fronteira onde texto NAO confiavel (saida de um modelo) vira acao: um erro
// aqui ou vaza um marcador interno para o cliente, ou perde um handoff que
// deveria ter acontecido.

// Substitui {variavel} pelo valor. Chave desconhecida fica como esta — melhor o
// prompt mostrar `{cliente}` do que uma lacuna silenciosa que ninguem percebe.
export function applyVariables(prompt: string, vars: Record<string, string> | null): string {
  if (!vars) return prompt;
  return prompt.replace(/\{([a-z0-9_]+)\}/gi, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : whole,
  );
}

// Detecta o marcador [HANDOFF] (linha propria, case-insensitive) e devolve o
// texto sem ele. O marcador NUNCA pode chegar ao contato.
export function extractHandoff(reply: string): { text: string; handoff: boolean } {
  const handoff = /(^|\n)\s*\[handoff\]\s*(\n|$)/i.test(reply);
  const text = reply.replace(/(^|\n)\s*\[handoff\]\s*(?=\n|$)/gi, '').trim();
  return { text, handoff };
}

// Detecta marcadores [MEDIA:rotulo] e devolve o texto sem eles + os rotulos.
export function extractMedia(reply: string): { text: string; labels: string[] } {
  const labels: string[] = [];
  const text = reply
    .replace(/\[media:\s*([a-z0-9_-]+)\s*\]/gi, (_w, label: string) => {
      labels.push(String(label).toLowerCase());
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return { text, labels };
}

// Extrai o JSON de uma resposta que pode vir embrulhada em cerca de markdown ou
// com texto em volta. Modelo nao garante formato; null e uma resposta valida
// aqui e o chamador trata como "sem sinal".
export function parseJsonLoose(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
