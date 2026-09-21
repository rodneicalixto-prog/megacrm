import * as React from 'react';
import { cn } from '@/lib/utils';

/** Placeholder de carregamento. Respeita prefers-reduced-motion (animate-pulse é desligado pelo Tailwind com motion-reduce). */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse motion-reduce:animate-none rounded-md bg-white/[0.06]', className)}
      {...props}
    />
  );
}

export { Skeleton };
