import { useEffect, useState } from 'react';
import { Toaster as SonnerToaster } from 'sonner';

function readTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

// Sonner tem tema próprio, independente do <html data-theme> que o
// ThemeToggle escreve — sem isso o toast ficava sempre escuro (glass-card
// com cor de fundo fixa), virando um "card preto" solto sobre o tema claro.
function useAppTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function Toaster() {
  const theme = useAppTheme();
  return (
    <SonnerToaster
      theme={theme}
      position="top-right"
      richColors
      toastOptions={{
        classNames: {
          toast:
            'glass-card !border-[var(--color-border-card)] !bg-[var(--surface)] !text-[var(--color-text-primary)]',
          description: '!text-[var(--color-text-secondary)]',
        },
      }}
    />
  );
}
