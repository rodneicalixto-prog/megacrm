import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FileText, Loader2, Sparkles, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { getSupabase } from '@/lib/supabase';
import { useLegalCases } from '@/hooks/useLegalCases';
import { useDepartments } from '@/hooks/useDepartments';
import { LEGAL_ATTACHMENTS_BUCKET } from '@/types/legal';

interface ExtractedFields {
  case_number: string | null;
  deadline_at: string | null;
  deadline_label: string | null;
  opposing_party: string | null;
  court_reference: string | null;
  classification: string | null;
  summary: string;
}

type Step = 'upload' | 'review';

export function NewIntimationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { createCase } = useLegalCases();
  const { departments } = useDepartments();
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [stagingPath, setStagingPath] = useState<string | null>(null);
  const [usedOcr, setUsedOcr] = useState(false);

  const [title, setTitle] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [classification, setClassification] = useState('');
  const [opposingParty, setOpposingParty] = useState('');
  const [courtReference, setCourtReference] = useState('');
  const [deadlineAt, setDeadlineAt] = useState('');
  const [deadlineLabel, setDeadlineLabel] = useState('');
  const [summary, setSummary] = useState('');

  const reset = () => {
    setStep('upload'); setFile(null); setStagingPath(null); setUsedOcr(false);
    setTitle(''); setCaseNumber(''); setDepartmentId(''); setClassification('');
    setOpposingParty(''); setCourtReference(''); setDeadlineAt(''); setDeadlineLabel(''); setSummary('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const pickFile = async (f: File | null) => {
    if (!f) return;
    if (f.type !== 'application/pdf') {
      toast.error('Envie um arquivo PDF.');
      return;
    }
    setFile(f);
    setExtracting(true);
    try {
      const path = `_intake/${crypto.randomUUID()}-${f.name}`;
      const { error: uploadErr } = await getSupabase().storage.from(LEGAL_ATTACHMENTS_BUCKET).upload(path, f);
      if (uploadErr) {
        toast.error('Falha ao enviar o PDF', { description: uploadErr.message });
        return;
      }
      setStagingPath(path);

      const { data, error: fnErr } = await getSupabase().functions.invoke('extract-legal-intimation', {
        body: { storage_path: path },
      });
      if (fnErr || !data?.ok) {
        toast.error('Falha ao ler a intimação', { description: data?.error ?? fnErr?.message });
        return;
      }

      const extracted = data.extracted as ExtractedFields;
      setUsedOcr(Boolean(data.used_ocr));
      setCaseNumber(extracted.case_number ?? '');
      setClassification(extracted.classification ?? '');
      setOpposingParty(extracted.opposing_party ?? '');
      setCourtReference(extracted.court_reference ?? '');
      setDeadlineAt(extracted.deadline_at ?? '');
      setDeadlineLabel(extracted.deadline_label ?? '');
      setSummary(extracted.summary ?? '');
      setTitle(extracted.classification ? `${extracted.classification}${extracted.opposing_party ? ' — ' + extracted.opposing_party : ''}` : f.name.replace(/\.pdf$/i, ''));
      setStep('review');
    } finally {
      setExtracting(false);
    }
  };

  const submit = async () => {
    if (!title.trim()) { toast.error('Informe um título.'); return; }
    if (!departmentId) { toast.error('Selecione o setor responsável.'); return; }
    if (!stagingPath || !file) { toast.error('Reenvie o PDF.'); return; }

    setSaving(true);
    try {
      const createRes = await createCase({
        title: title.trim(),
        department_id: departmentId,
        case_number: caseNumber.trim() || null,
        classification: classification.trim() || null,
        opposing_party: opposingParty.trim() || null,
        court_reference: courtReference.trim() || null,
        next_deadline_at: deadlineAt ? new Date(deadlineAt).toISOString() : null,
        next_deadline_label: deadlineLabel.trim() || null,
        summary: summary.trim() || null,
      });
      if (!createRes.ok) {
        toast.error('Falha ao criar processo', { description: createRes.error });
        return;
      }
      const caseId = createRes.id;
      const finalPath = `${caseId}/${file.name}`;

      const { error: moveErr } = await getSupabase().storage.from(LEGAL_ATTACHMENTS_BUCKET).move(stagingPath, finalPath);
      const attachedPath = moveErr ? stagingPath : finalPath;
      if (moveErr) {
        console.error('[NewIntimationDialog] falha ao mover anexo pro caminho final', moveErr);
      }

      await getSupabase().schema('whatsapp_hub').from('legal_case_attachments').insert({
        case_id: caseId,
        storage_path: attachedPath,
        file_name: file.name,
        mime_type: 'application/pdf',
        size_bytes: file.size,
      });

      if (summary.trim()) {
        await getSupabase().schema('whatsapp_hub').rpc('append_legal_case_briefing', {
          p_case_id: caseId,
          p_trigger_type: 'versao_inicial',
          p_trigger_label: 'Extraído automaticamente da intimação',
          p_summary_text: summary.trim(),
          p_classification: classification.trim() || null,
        });
      }

      if (deadlineAt) {
        await getSupabase().schema('whatsapp_hub').from('legal_case_tasks').insert({
          case_id: caseId,
          title: deadlineLabel.trim() || 'Cumprir prazo do processo',
          due_at: new Date(deadlineAt).toISOString(),
        });
      }

      toast.success('Processo criado a partir da intimação.');
      handleClose();
      navigate(`/juridico/${caseId}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} title="Nova intimação" description="Envie o PDF — a IA extrai número, prazo, partes e um resumo pra você conferir antes de criar o processo." widthClass="max-w-lg">
      {step === 'upload' && (
        <div>
          <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={extracting}
            className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-[rgba(59,130,246,0.3)] py-10 text-center text-[var(--color-text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--color-text-primary)]"
          >
            {extracting ? <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-primary)]" /> : <Upload className="h-6 w-6 text-[var(--accent-primary)]" />}
            <div className="text-sm"><b>{extracting ? 'Lendo o PDF…' : 'Clique para enviar a intimação'}</b></div>
            <div className="text-xs">PDF — até 25MB</div>
          </button>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg bg-[rgba(139,92,246,0.08)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#8B5CF6]" />
            <span>Campos extraídos de <b className="text-[var(--color-text-primary)]">{file?.name}</b>{usedOcr ? ' (via OCR — confira com atenção)' : ''}. Revise antes de criar.</span>
          </div>

          <div>
            <label className="text-label mb-1.5 block">Título</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-label mb-1.5 block">Nº do processo</label>
              <input value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)}
                className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
            </div>
            <div>
              <label className="text-label mb-1.5 block">Setor</label>
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]">
                <option value="">Selecione…</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-label mb-1.5 block">Classificação</label>
              <input value={classification} onChange={(e) => setClassification(e.target.value)}
                className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
            </div>
            <div>
              <label className="text-label mb-1.5 block">Parte contrária</label>
              <input value={opposingParty} onChange={(e) => setOpposingParty(e.target.value)}
                className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
            </div>
          </div>
          <div>
            <label className="text-label mb-1.5 block">Vara / tribunal</label>
            <input value={courtReference} onChange={(e) => setCourtReference(e.target.value)}
              className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-label mb-1.5 block">Próximo prazo</label>
              <input type="date" value={deadlineAt} onChange={(e) => setDeadlineAt(e.target.value)}
                className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
            </div>
            <div>
              <label className="text-label mb-1.5 block">O que é o prazo</label>
              <input value={deadlineLabel} onChange={(e) => setDeadlineLabel(e.target.value)}
                className="w-full rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
            </div>
          </div>
          <div>
            <label className="text-label mb-1.5 block">Resumo (vira a primeira versão da contracapa)</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4}
              className="w-full resize-none rounded-lg border border-[rgba(59,130,246,0.2)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--accent-primary)]" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>Cancelar</Button>
            <Button type="button" onClick={() => void submit()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Criar processo
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
