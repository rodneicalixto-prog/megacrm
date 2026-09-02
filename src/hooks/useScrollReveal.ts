import { useEffect, useRef } from 'react';

// Revela o elemento (opacity/translateY definidos em [data-animate] no
// globals.css) quando ele entra na viewport. Uso:
//   const ref = useScrollReveal<HTMLDivElement>();
//   <div ref={ref} data-animate data-delay="1">...</div>
export function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}
