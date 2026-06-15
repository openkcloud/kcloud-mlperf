import type { AxiosError } from 'axios';
import { type StateCreator } from 'zustand';

// ----------------------------------------------------------------------

type NotificationType = 'success' | 'error' | 'warning' | 'info';

type NotificationState = {
  message: string;
  type: NotificationType;
};

type NotificationMethods = {
  setNotification: (params: NotificationState) => void;
  setErrorNotification: (error: unknown) => void;
  clearNotification: VoidFunction;
};

export type NotificationSlice = {
  notification: NotificationState & NotificationMethods;
};

// ----------------------------------------------------------------------

const initialNotificationData: NotificationState = {
  message: '',
  type: 'info'
};

// ----------------------------------------------------------------------

export const createNotificationSlice: StateCreator<
  NotificationSlice,
  [],
  [],
  NotificationSlice
> = set => ({
  notification: {
    ...initialNotificationData,

    setNotification: params =>
      set(state => ({
        ...state,
        notification: {
          ...state.notification,
          ...params
        }
      })),

    setErrorNotification: error => {
      const originalError = error as AxiosError;
      const messageText = originalError.response?.statusText || '';

      return set(state => ({
        ...state,
        notification: {
          ...state.notification,
          type: 'error',
          message: messageText
        }
      }));
    },

    clearNotification: () =>
      set(state => ({
        ...state,
        notification: {
          ...state.notification,
          message: ''
        }
      }))
  }
});
