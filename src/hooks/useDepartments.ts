import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export interface Department {
  id: string;
  name: string;
  is_default: boolean;
}

export interface DepartmentLine {
  id: string;
  department_id: string;
  instance: string;
  phone_number: string | null;
  label: string | null;
}

// Departamentos + linhas (números) conectadas, para os filtros de equipe e de
// canal/número do inbox. Um departamento pode ter dezenas de linhas, então as
// duas listas são eixos distintos, não um só.
export function useDepartments() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [lines, setLines] = useState<DepartmentLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabase().schema('whatsapp_hub');
      const [deps, conns] = await Promise.all([
        supabase.from('departments').select('id, name, is_default').order('name'),
        supabase
          .from('department_connections')
          .select('id, department_id, instance, phone_number, label')
          .order('instance'),
      ]);
      if (cancelled) return;
      setDepartments((deps.data ?? []) as Department[]);
      setLines((conns.data ?? []) as DepartmentLine[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { departments, lines, loading };
}

// Rótulo de uma linha na UI: o número é o que o atendente reconhece; o nome da
// instância só aparece quando não há número gravado.
export function lineLabel(l: DepartmentLine): string {
  return l.label ?? l.phone_number ?? l.instance;
}
