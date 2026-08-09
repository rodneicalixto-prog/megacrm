// Declaracoes minimas do runtime Deno/Supabase para o type-check rodar em Node.
//
// Estas funcoes rodam em Deno, mas nada aqui usa o SDK do Deno alem do que esta
// declarado abaixo — sao 3 APIs. Declarar essa fatia e o suficiente para o tsc
// verificar os ~5.900 linhas de logica, que ate entao nao passavam por
// compilador nenhum. NAO e um shim de execucao: em producao quem fornece isso e
// o proprio runtime.

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// Extensao do Supabase Edge Runtime: mantem uma promise viva depois da resposta
// (usado pelo redirect-tracker, que grava a sessao sem segurar o redirect).
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

// As functions importam o supabase-js por URL (Deno). Para o tsc, apontamos o
// mesmo specifier para os tipos do pacote instalado em node_modules — a versao
// da URL e a mesma do package.json.
declare module 'https://esm.sh/@supabase/supabase-js@2.45.0' {
  export * from '@supabase/supabase-js';
}

// unpdf so e usado no process-knowledge para extrair texto de PDF.
declare module 'https://esm.sh/unpdf@0.12.1' {
  // Aceita bytes crus OU o proxy devolvido por getDocumentProxy.
  export function extractText(
    data: unknown,
    opts?: { mergePages?: boolean },
  ): Promise<{ totalPages: number; text: string | string[] }>;
  export function getDocumentProxy(data: Uint8Array): Promise<unknown>;
}
