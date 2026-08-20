/**
 * Divide um array em lotes de tamanho fixo.
 *
 * Usado para fatiar arrays potencialmente grandes (ex.: todos os ids de
 * contatos que batem um filtro) antes de usá-los num filtro `.in()` do
 * PostgREST/Supabase — evita URLs enormes / estourar limites de parâmetros
 * quando o array escala com o volume de linhas de uma tabela.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunkArray: size deve ser > 0');
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
