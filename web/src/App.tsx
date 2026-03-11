import { NotificationProvider } from '@/contexts/NotificationContext';
import { ReactQueryProvider } from '@/contexts/QueryContext';
import { RouterProvider } from '@/contexts/RouterContext';
import { Routes } from '@/contexts/RouterContext/Routes';
import { ThemeProvider } from '@/contexts/ThemeContext';

import { MainLayout } from '@/layouts/MainLayout';

// ----------------------------------------------------------------------

export const App = () => {
  return (
    <RouterProvider>
      <ThemeProvider>
        <ReactQueryProvider>
          <NotificationProvider>
            <MainLayout>
              <Routes />
            </MainLayout>
          </NotificationProvider>
        </ReactQueryProvider>
      </ThemeProvider>
    </RouterProvider>
  );
};
