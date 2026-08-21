import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'dark' | 'light';
const KEY = 'megacrm-theme';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem(KEY) === 'light' ? 'light' : 'dark',
  );

  useEffect(() => applyTheme(theme), [theme]);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    setTheme(next);
  };

  return (
    <button type="button" onClick={toggle}
      className="relative flex h-9 w-[68px] items-center rounded-full border border-[var(--color-border-card)] bg-[var(--color-bg-elevated)] p-1 transition-colors"
      aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
      title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}>
      <span className="absolute left-2 text-[var(--color-text-secondary)]"><Moon className="h-3.5 w-3.5" /></span>
      <span className="absolute right-2 text-[var(--color-text-secondary)]"><Sun className="h-3.5 w-3.5" /></span>
      <span className={"relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-primary)] text-white transition-transform " + (theme === 'light' ? 'translate-x-7' : 'translate-x-0')}>
        {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}
