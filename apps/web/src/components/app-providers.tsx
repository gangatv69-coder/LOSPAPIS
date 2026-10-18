import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';

/** Proveedores visuales. QueryClientProvider y RouterProvider van fuera/dentro; no dependen de este. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system">
      <MotionConfig reducedMotion="user">
        {children}
        <Toaster position="top-center" />
      </MotionConfig>
    </ThemeProvider>
  );
}
