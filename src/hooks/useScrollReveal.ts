import { useCallback, useRef } from 'react';

// Revela o elemento (opacity/translateY definidos em [data-animate] no
// globals.css) quando ele entra na viewport. Uso:
//   const ref = useScrollReveal<HTMLDivElement>();
//   <div ref={ref} data-animate data-delay="1">...</div>
//
// Callback ref em vez de useRef+useEffect: o efeito de useRef só roda uma vez
// no mount do componente, mas o elemento observado costuma estar atrás de um
// branch condicional (ex.: "carregando..." vs. conteúdo real). Nesse caso,
// ref.current é null na primeira renderização, o observer nunca é criado, e
// quando o elemento real aparece depois (dados chegaram) ninguém o observa —
// fica com opacity:0 pra sempre mesmo com dados corretos dentro. Um callback
// ref dispara toda vez que o nó DOM é anexado, inclusive quando isso só
// acontece depois de um estado assíncrono resolver.
export function useScrollReveal<T extends HTMLElement>() {
  const observerRef = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
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
    observerRef.current = observer;
  }, []);

  return ref;
}
