import { Card } from '@/components/ui/card';
import { getSupabase } from '@/lib/supabase';
import { useAppUser } from '@/app/providers/AppUserProvider';
import { BusinessHoursEditor, type BusinessHours } from '@/components/settings/BusinessHoursEditor';

// Horário padrão global da instância — singleton em whatsapp_hub.app_settings
// (id=1). Departamento (DepartmentsSettings.tsx) e usuário (AccountSettings.tsx)
// podem sobrescrever este valor com o próprio horário; sem override, a IA usa
// este aqui (ver process-ai-message/index.ts, resolveBusinessHours).
export function BusinessHoursSettings() {
  const { userId } = useAppUser();

  return (
    <Card>
      <div className="space-y-1 mb-4">
        <h2 className="text-xl font-bold text-display">Horário de atendimento</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Padrão da instância. Fora desses horários (e sem override de setor ou
          usuário), o agente de IA envia a mensagem de fallback abaixo.
        </p>
      </div>
      {userId && (
        <BusinessHoursEditor
          title=""
          description=""
          load={async () => {
            const { data } = await getSupabase()
              .from('app_settings')
              .select('business_hours, out_of_hours_message')
              .eq('id', 1)
              .maybeSingle();
            return data ?? null;
          }}
          save={async (patch: { business_hours: BusinessHours | null; out_of_hours_message: string | null }) => {
            const { error } = await getSupabase()
              .from('app_settings')
              .update({
                business_hours: patch.business_hours ?? {},
                out_of_hours_message: patch.out_of_hours_message,
              })
              .eq('id', 1);
            return { error: error?.message };
          }}
        />
      )}
    </Card>
  );
}
