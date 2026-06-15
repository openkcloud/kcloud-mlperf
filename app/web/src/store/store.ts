import { create } from 'zustand';

import {
  type ComparisonSlice,
  createTestComparisonSlice
} from '@/store/slices/comparison-slice.ts';
import { type NotificationSlice, createNotificationSlice } from '@/store/slices/notification-slice';

export type BoundStore = NotificationSlice & ComparisonSlice;

export const createBoundStore = create<BoundStore>()((...a) => ({
  ...createNotificationSlice(...a),
  ...createTestComparisonSlice(...a)
}));
