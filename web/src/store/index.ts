import { useStore as useZustandStore } from 'zustand';

import { type BoundStore, createBoundStore } from '@/store/store';

export const useStore = <T extends any>(selector: (store: BoundStore) => T): T => {
  return useZustandStore(createBoundStore, selector);
};
