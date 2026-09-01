// Estimativa de custo por mensagem da IA, a partir dos tokens que o provider
// devolveu (ver LLMCallResult.usage em llm.ts). Preços em USD por 1M tokens —
// TABELA ESTÁTICA, fica desatualizada quando o provider muda preço; serve
// como estimativa para o dashboard de observabilidade, não como fatura.
// Revisar periodicamente contra a tabela oficial de cada provider.

interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

// Chave por prefixo do nome do modelo (match mais específico primeiro).
const PRICE_TABLE: Array<{ prefix: string; price: ModelPrice }> = [
  { prefix: 'gpt-4.1-mini', price: { inputPer1M: 0.4, outputPer1M: 1.6 } },
  { prefix: 'gpt-4.1', price: { inputPer1M: 2.0, outputPer1M: 8.0 } },
  { prefix: 'gpt-4o-mini', price: { inputPer1M: 0.15, outputPer1M: 0.6 } },
  { prefix: 'gpt-4o', price: { inputPer1M: 2.5, outputPer1M: 10.0 } },
  { prefix: 'claude-sonnet', price: { inputPer1M: 3.0, outputPer1M: 15.0 } },
  { prefix: 'claude-haiku', price: { inputPer1M: 0.8, outputPer1M: 4.0 } },
  { prefix: 'claude-opus', price: { inputPer1M: 15.0, outputPer1M: 75.0 } },
  { prefix: 'gemini-1.5-flash', price: { inputPer1M: 0.075, outputPer1M: 0.3 } },
  { prefix: 'gemini-1.5-pro', price: { inputPer1M: 1.25, outputPer1M: 5.0 } },
];

export function estimateCostUsd(
  model: string,
  usage: { inputTokens: number | null; outputTokens: number | null },
): number | null {
  if (usage.inputTokens == null && usage.outputTokens == null) return null;
  const entry = PRICE_TABLE.find((p) => model.startsWith(p.prefix));
  if (!entry) return null;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cost = (input / 1_000_000) * entry.price.inputPer1M + (output / 1_000_000) * entry.price.outputPer1M;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6 casas — mensagens custam frações de centavo
}
