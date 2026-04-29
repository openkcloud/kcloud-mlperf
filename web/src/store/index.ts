import { useStore as useZustandStore } from 'zustand';

import { type BoundStore, createBoundStore } from '@/store/store';

export const useStore = <T>(selector: (store: BoundStore) => T): T => {
  return useZustandStore(createBoundStore, selector);
};
