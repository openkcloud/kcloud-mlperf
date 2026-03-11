import { Fragment, type ReactNode } from 'react';

import { AppMessageView } from '@/components/AppMessageView';

// ----------------------------------------------------------------------

type NotificationProvider = {
  children: ReactNode;
};

// ----------------------------------------------------------------------

export const NotificationProvider = (props: NotificationProvider) => {
  const { children } = props;

  return (
    <Fragment>
      {children}
      <AppMessageView />
    </Fragment>
  );
};
