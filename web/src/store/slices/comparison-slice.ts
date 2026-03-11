import { type StateCreator } from 'zustand';

import { MpExamModeEnum } from '@/enums/mp-exam-mode.enum';

// ----------------------------------------------------------------------

type ExamType = 'mp' | 'ml';

type ComparisonTestState = {
  mpExamIds: number[];
  mlExamIds: number[];
  mpExamMode: MpExamModeEnum | null;
};

type ComparisonTestMethods = {
  setExamId: (id: number, type: ExamType) => void;
  removeExamId: (id: number, type: ExamType) => void;
  clearExamIds: (type: ExamType) => void;
  setMpExamMode: (mode: MpExamModeEnum) => void;
  clearMpExamMode: VoidFunction;
};

export type ComparisonSlice = {
  testComparison: ComparisonTestState & ComparisonTestMethods;
};

// ----------------------------------------------------------------------

const initialComparisonData: ComparisonTestState = {
  mpExamIds: [],
  mlExamIds: [],
  mpExamMode: null
};

// ----------------------------------------------------------------------

export const createTestComparisonSlice: StateCreator<
  ComparisonSlice,
  [],
  [],
  ComparisonSlice
> = set => ({
  testComparison: {
    ...initialComparisonData,

    setExamId: (id, type) =>
      set(state => ({
        ...state,
        testComparison: {
          ...state.testComparison,
          mpExamIds:
            type === 'mp'
              ? [...state.testComparison.mpExamIds, id]
              : state.testComparison.mpExamIds,
          mlExamIds:
            type === 'ml' ? [...state.testComparison.mlExamIds, id] : state.testComparison.mlExamIds
        }
      })),

    removeExamId: (id, type) =>
      set(state => {
        return {
          ...state,
          testComparison: {
            ...state.testComparison,
            mpExamIds:
              type === 'mp'
                ? state.testComparison.mpExamIds.filter(itemId => itemId !== id)
                : state.testComparison.mpExamIds,
            mlExamIds:
              type === 'ml'
                ? state.testComparison.mlExamIds.filter(itemId => itemId !== id)
                : state.testComparison.mlExamIds
          }
        };
      }),

    clearExamIds: type =>
      set(state => ({
        ...state,
        testComparison: {
          ...state.testComparison,
          mpExamIds: type === 'mp' ? [] : state.testComparison.mpExamIds,
          mlExamIds: type === 'ml' ? [] : state.testComparison.mlExamIds
        }
      })),

    setMpExamMode: mode =>
      set(state => ({
        ...state,
        testComparison: {
          ...state.testComparison,
          mpExamMode: mode
        }
      })),

    clearMpExamMode: () =>
      set(state => ({
        ...state,
        testComparison: {
          ...state.testComparison,
          mpExamMode: null
        }
      }))
  }
});
