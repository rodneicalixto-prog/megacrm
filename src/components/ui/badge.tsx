import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral:
          'border-[rgb(var(--accent-rgb)/0.15)] bg-white/5 text-[var(--color-text-secondary)]',
        accent:
          'border-[rgb(var(--accent-rgb)/0.3)] bg-[rgb(var(--accent-rgb)/0.12)] text-[color:var(--accent-secondary)]',
        success:
          'border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]',
        warning:
          'border-amber-400/30 bg-amber-400/10 text-amber-400',
        danger:
          'border-[var(--color-error)]/30 bg-[var(--color-error)]/10 text-[var(--color-error)]',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
