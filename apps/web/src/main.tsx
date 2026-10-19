import './fonts';
import './styles/globals.css';
import './i18n';

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppProviders } from '@/components/app-providers';
import { queryClient } from '@/lib/query-client';
import { registerServiceWorker } from '@/pwa/register-sw';
import { router } from '@/router';

// Avisos push (PWA): el service worker se registra al terminar de cargar la página.
registerServiceWorker();

const container = document.getElementById('root');
if (!container) {
  throw new Error('No existe el elemento #root en index.html');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </QueryClientProvider>
  </StrictMode>,
);
