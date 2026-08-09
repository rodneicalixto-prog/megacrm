import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { fetchBranding, primeBranding, useBranding } from '@/hooks/useBranding';

const BUCKET = 'whatsapp-hub-branding';
const MAX_BYTES = 2 * 1024 * 1024;

// Nome e logo da empresa. Não é white-label: o tema segue fixo. São dois campos
// para a empresa se ver no próprio CRM.
export function BrandingSettings() {
  const { branding, reload } = useBranding();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(branding.companyName ?? '');
  }, [branding.companyName]);

  const persist = async (patch: { company_name?: string | null; logo_url?: string | null }) => {
    const supabase = getSupabase();
    const { data: row } = await supabase
      .schema('whatsapp_hub').from('app_settings').select('id').limit(1).maybeSingle();

    const { error } = row
      ? await supabase.schema('whatsapp_hub').from('app_settings')
          .update(patch).eq('id', (row as { id: number }).id)
      : await supabase.schema('whatsapp_hub').from('app_settings').insert({ id: 1, ...patch });

    if (error) throw new Error(error.message);
    primeBranding(await fetchBranding());
    await reload();
  };

  const saveName = async () => {
    setSaving(true);
    try {
      await persist({ company_name: name.trim() || null });
      toast.success('Nome da empresa salvo.');
    } catch (err) {
      toast.error('Não foi possível salvar', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error('Imagem acima de 2MB.');
      return;
    }
    setUploading(true);
    try {
      const supabase = getSupabase();
      // Caminho único: navegador e CDN guardam a URL antiga com afinco.
      const path = `logo-${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      await persist({ logo_url: data.publicUrl });
      toast.success('Logo atualizada.');
    } catch (err) {
      toast.error('Falha ao enviar a logo', {
        description: err instanceof Error ? err.message : 'Erro interno',
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="glass-card p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Identidade</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Nome e logo que aparecem no menu e na tela de entrada.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-label" htmlFor="company-name">Nome da empresa</label>
        <div className="flex flex-wrap gap-2">
          <input
            id="company-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Athenas"
            className="min-w-0 flex-1 rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-4 py-2.5 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--accent-primary)]"
          />
          <button
            type="button"
            onClick={() => void saveName()}
            disabled={saving}
            className="rounded-lg bg-gradient-to-br from-[#1E3A8A] to-[#3B82F6] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-label">Logo</span>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-[rgba(59,130,246,0.2)] bg-white/[0.03]">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="Logo atual" className="h-14 w-14 object-contain" />
            ) : (
              <ImageIcon className="h-6 w-6 text-[var(--color-text-secondary)]" />
            )}
          </div>
          <div className="min-w-0">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 rounded-lg border border-[rgba(59,130,246,0.25)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)] transition hover:border-[var(--accent-primary)] disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? 'Enviando…' : 'Enviar logo'}
            </button>
            <p className="mt-1.5 text-xs text-[var(--color-text-secondary)]">
              PNG, JPG, WEBP ou SVG · até 2MB · fundo transparente fica melhor
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
