// Módulos do pacote comercial que podem ser vendidos separadamente
// (Campanhas, Vendas & Recompra, Agente de IA). Tipo compartilhado entre
// nav-config.ts (esconder o item de menu) e useEnabledModules.ts (ler o
// que está habilitado nesta instalação via a Edge Function
// get-instance-plan). Ver supabase/functions/_shared/plan.ts para a mesma
// lista do lado do backend.
export type CommercialModule = 'campaigns' | 'vendas' | 'ai_agent';
