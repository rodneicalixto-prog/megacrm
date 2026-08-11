import type React from 'react';
import { Check, ExternalLink } from 'lucide-react';
import type { Step } from './setupCore';

const STEP_LABELS = ['PREPARAR', 'CREDENCIAIS', 'BOOTSTRAP', 'APIS'] as const;

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={[
        'min-h-12 rounded-xl px-8 py-4 text-base font-medium text-white transition-[box-shadow,opacity,transform] duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
        'bg-[linear-gradient(135deg,#1E3A8A_0%,#3B82F6_100%)] shadow-[0_8px_40px_rgba(59,130,246,0.4),0_0_60px_rgba(59,130,246,0.2)]',
        'hover:shadow-[0_8px_50px_rgba(59,130,246,0.6),0_0_80px_rgba(59,130,246,0.3)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none',
        'w-full sm:w-auto',
        props.className ?? '',
      ].join(' ')}
    />
  );
}

export function StepIndicator({ step }: { step: Step }) {
  return (
    <div className="mb-10 flex w-full items-start justify-center">
      {STEP_LABELS.map((label, index) => {
        const n = index + 1;
        const active = step === n;
        const complete = step > n;
        return (
          <div key={label} className="flex min-w-0 flex-1 items-start last:flex-none sm:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={[
                  'flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold',
                  active
                    ? 'bg-[#3B82F6] text-white shadow-[0_0_30px_rgba(59,130,246,0.5)]'
                    : complete
                      ? 'bg-[#1E3A8A] text-white'
                      : 'border border-[rgba(59,130,246,0.3)] bg-transparent text-[#94A3B8]',
                ].join(' ')}
              >
                {complete ? <Check className="h-4 w-4" /> : n}
              </div>
              <div
                className={[
                  'mt-3 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.1em]',
                  active ? 'text-[#F8FAFC]' : 'text-[#94A3B8]',
                ].join(' ')}
              >
                {label}
              </div>
            </div>
            {index < STEP_LABELS.length - 1 ? (
              <div className="mx-2 mt-5 h-px w-8 border-t border-[rgba(59,130,246,0.2)] sm:mx-5 sm:w-20" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function SetupCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[rgba(59,130,246,0.15)] bg-white/[0.02] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[40px] md:p-12">
      {children}
    </div>
  );
}

export function PrepItem({
  n,
  title,
  text,
  href,
  pills,
}: {
  n: number;
  title: string;
  text: string;
  href: string;
  pills: string[];
}) {
  return (
    <div className="relative rounded-xl border border-[rgba(59,130,246,0.12)] bg-white/[0.02] p-5">
      <div className="flex gap-4 pr-16">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(59,130,246,0.4)] text-sm font-medium text-[#60A5FA]">
          {n}
        </div>
        <div>
          <h2 className="text-base font-semibold text-[#F8FAFC]">{title}</h2>
          <p className="mt-1 text-[13px] leading-5 text-[#94A3B8]">{text}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {pills.map((pill) => (
              <span
                key={pill}
                className="rounded-full border border-[rgba(59,130,246,0.3)] bg-[rgba(30,58,138,0.4)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.05em] text-[#60A5FA]"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="absolute right-5 top-5 inline-flex items-center gap-1 text-sm text-[#60A5FA] hover:text-[#85B7EB]"
      >
        abrir
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
