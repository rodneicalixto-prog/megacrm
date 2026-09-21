import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * <select> nativo estilizado no padrão do Input. Nativo de propósito: abre o
 * seletor do sistema no mobile, é acessível por teclado e não exige dependência.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <div className="relative w-full">
      <select
        ref={ref}
        className={cn(
          'h-11 w-full appearance-none rounded-lg border border-[rgb(var(--accent-rgb)/0.2)] bg-white/[0.03] pl-4 pr-10 text-sm',
          'text-[var(--color-text-primary)] transition-colors',
          'focus:border-[var(--accent-primary)] focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]"
      />
    </div>
  ),
);
Select.displayName = 'Select';

export { Select };
