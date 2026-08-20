import { cn } from '@/lib/utils';

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Paleta fixa, tons próximos do accent do design system (azul) mas com
// variação suficiente para distinguir pessoas de relance. Nunca aleatória —
// o hash do nome sempre resolve pra mesma cor, então a mesma pessoa aparece
// igual em toda a UI.
const PALETTE = [
  '#3B82F6', // accent-primary
  '#60A5FA', // accent-secondary
  '#818CF8', // indigo
  '#38BDF8', // sky
  '#22D3EE', // cyan
  '#A78BFA', // violet
];

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-6 w-6 text-[0.6rem]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-11 w-11 text-sm',
};

// Hash simples e determinístico (djb2) — suficiente pra distribuir nomes na
// paleta sem depender de crypto.
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

function getColor(name: string): string {
  const key = name.trim().toLowerCase();
  if (!key) return PALETTE[0];
  return PALETTE[hashString(key) % PALETTE.length];
}

// Badge circular com as iniciais da pessoa. Sem upload de foto por design —
// isso fica pra uma feature futura de avatar com imagem.
export function Avatar({ name, size = 'md', className }: AvatarProps) {
  const initials = getInitials(name);
  const background = getColor(name);
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        SIZE_CLASSES[size],
        className,
      )}
      style={{ backgroundColor: background }}
    >
      {initials}
    </span>
  );
}
