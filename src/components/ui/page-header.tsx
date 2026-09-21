import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Ações à direita (botões). Vão para baixo do título no mobile. */
  actions?: React.ReactNode;
}

function PageHeader({ title, description, actions, className, ...props }: PageHeaderProps) {
  return (
    <div
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}
      {...props}
    >
      <div className="min-w-0">
        <h1 className="text-display text-2xl text-[var(--color-text-primary)]">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export { PageHeader };
