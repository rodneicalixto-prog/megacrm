import { useEffect, useRef } from 'react';

// Aplica um deslocamento vertical proporcional ao scroll. speed 0.1 (sutil)
// a 0.5 (intenso). Uso: const ref = useParallax<HTMLDivElement>(0.2);
export function useParallax<T extends HTMLElement>(speed = 0.2) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const onScroll = () => {
      el.style.transform = `translateY(${window.scrollY * speed}px)`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [speed]);

  return ref;
}
