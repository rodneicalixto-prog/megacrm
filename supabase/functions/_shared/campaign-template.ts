// Montagem do template de um broadcast. Puro: template + mapeamento de
// variaveis entram, componentes da Meta e a lista de faltantes saem.
//
// Separado do dispatch-campaign porque e a decisao que determina se a mensagem
// chega ou some. Broadcast NAO personaliza por destinatario: so variavel
// 'literal' com valor pode ser preenchida. Qualquer outra tem que ser reportada
// em `missing` para o chamador FALHAR a linha — enviar parametro vazio faz a
// Meta recusar com "Required template parameter is missing", e o contato nunca
// recebe nada nem ninguem fica sabendo.

export interface TemplateBody {
  body: string;
}

export type VariableSource =
  | { source: 'literal'; value: string }
  | { source: 'contact_field'; field: 'name' | 'email' | 'phone' }
  | { source: 'custom_field'; field: string };

// Conta variaveis DISTINTAS: {{1}} repetido duas vezes e um parametro so.
export function countVariables(body: string): number {
  const matches = body.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  return new Set(matches).size;
}

export function buildBroadcastComponents(
  template: TemplateBody,
  mapping: Record<string, VariableSource> | null,
): { components: unknown[]; missing: number[] } {
  const varCount = countVariables(template.body);
  if (varCount === 0) return { components: [], missing: [] };
  const parameters: Array<{ type: 'text'; text: string }> = [];
  const missing: number[] = [];
  for (let i = 1; i <= varCount; i++) {
    const src = mapping?.[String(i)];
    if (src?.source === 'literal' && src.value.trim() !== '') {
      parameters.push({ type: 'text', text: src.value });
    } else {
      missing.push(i);
      parameters.push({ type: 'text', text: '' });
    }
  }
  return { components: [{ type: 'body', parameters }], missing };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Preview do corpo com os literais aplicados. Variavel sem literal fica como
// `{{n}}` de proposito: o operador ve na inbox o que a Meta receberia.
export function renderTemplatePreview(
  body: string,
  mapping: Record<string, VariableSource> | null,
): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_w, n: string) => {
    const src = mapping?.[n];
    return src?.source === 'literal' ? src.value : `{{${n}}}`;
  });
}
