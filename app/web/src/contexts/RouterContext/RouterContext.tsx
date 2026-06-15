import { type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

// ----------------------------------------------------------------------

type RouterProviderProps = {
  children: ReactNode;
};

// ----------------------------------------------------------------------

export const RouterProvider = (props: RouterProviderProps) => {
  const { children } = props;

  return <BrowserRouter>{children}</BrowserRouter>;
};
