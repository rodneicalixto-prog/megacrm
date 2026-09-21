import { BrowserRouter } from 'react-router-dom';
import { SupabaseProvider } from './app/providers/SupabaseProvider';
import { AuthProvider } from './app/providers/AuthProvider';
import { AppUserProvider } from './app/providers/AppUserProvider';
import { QueryProvider } from './app/providers/QueryProvider';
import { AppRouter } from './app/router';
import { Toaster } from './components/ui/sonner';

export default function App() {
  return (
    <SupabaseProvider>
      <AuthProvider>
        <AppUserProvider>
          <QueryProvider>
            <BrowserRouter>
              <AppRouter />
              <Toaster />
            </BrowserRouter>
          </QueryProvider>
        </AppUserProvider>
      </AuthProvider>
    </SupabaseProvider>
  );
}
