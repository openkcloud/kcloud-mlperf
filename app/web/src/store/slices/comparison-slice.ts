import { type StateCreator } from 'zustand';

import { MpExamModeEnum } from '@/enums/mp-exam-mode.enum';

// ----------------------------------------------------------------------

type ExamType = 'mp' | 'ml';

/**
 * Captured config of the first selected exam — used by F2 fairness gating so
 * subsequent rows can disable when ANY config dimension differs (precision,
 * model, dataset, scenario, max_output_tokens, data_number).
 */
export type ComparisonAnchor = {
  precision?: string | null;
  model?: string | null;
  dataset?: string | null;
  scenario?: string | null;
  max_output_tokens?: number | null;
  data_number?: number | null;
};

type ComparisonTestState = {
  mpExamIds: number[];
  mlExamIds: number[];
  mpExamMode: MpExamModeEnum | null;
  /** Captured config of the first MP selection. Null while empty. */
  mpAnchor: ComparisonAnchor | null;
  /** Captured config of the first ML selection. Null while empty. */
  mlAnchor: ComparisonAnchor | null;
  /** Admin override — when true, F2 fairness gating is bypassed. */
  fairnessOverride: boolean;
};

type ComparisonTestMethods = {
  setExamId: (id: number, type: ExamType, anchor?: ComparisonAnchor) => void;
  removeExamId: (id: number, type: ExamType) => void;
  clearExamIds: (type: ExamType) => void;
  setMpExamMode: (mode: MpExamModeEnum) => void;
  clearMpExamMode: VoidFunction;
  setFairnessOverride: (v: boolean) => void;
};

export type ComparisonSlice = {
  testComparison: ComparisonTestState & ComparisonTestMethods;
};

// ----------------------------------------------------------------------

const initialComparisonData: ComparisonTestState = {
  mpExamIds: [],
  mlExamIds: [],
  mpExamMode: null,
  mpAnchor: null,
  mlAnchor: null,
  fairnessOverride: false
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

    setExamId: (id, type, anchor) =>
      set(state => {
        const isFirstMp = type === 'mp' && state.testComparison.mpExamIds.length === 0;
        const isFirstMl = type === 'ml' && state.testComparison.mlExamIds.length === 0;
        return {
          ...state,
          testComparison: {
            ...state.testComparison,
            mpExamIds:
              type === 'mp'
                ? [...state.testComparison.mpExamIds, id]
                : state.testComparison.mpExamIds,
            mlExamIds:
              type === 'ml'
                ? [...state.testComparison.mlExamIds, id]
                : state.testComparison.mlExamIds,
            // Capture the anchor only when this is the FIRST selection — that
            // exam defines the comparison config; subsequent rows must match it.
            mpAnchor: isFirstMp ? (anchor ?? null) : state.testComparison.mpAnchor,
            mlAnchor: isFirstMl ? (anchor ?? null) : state.testComparison.mlAnchor
          }
        };
      }),

    removeExamId: (id, type) =>
      set(state => {
        const nextMp =
          type === 'mp'
            ? state.testComparison.mpExamIds.filter(itemId => itemId !== id)
            : state.testComparison.mpExamIds;
        const nextMl =
          type === 'ml'
            ? state.testComparison.mlExamIds.filter(itemId => itemId !== id)
            : state.testComparison.mlExamIds;
        return {
          ...state,
          testComparison: {
            ...state.testComparison,
            mpExamIds: nextMp,
            mlExamIds: nextMl,
            // Drop the anchor when the list is empty so the next first-pick re-anchors.
            mpAnchor: type === 'mp' && nextMp.length === 0 ? null : state.testComparison.mpAnchor,
            mlAnchor: type === 'ml' && nextMl.length === 0 ? null : state.testComparison.mlAnchor
          }
        };
      }),

    clearExamIds: type =>
      set(state => ({
        ...state,
        testComparison: {
          ...state.testComparison,
          mpExamIds: type === 'mp' ? [] : state.testComparison.mpExamIds,
          mlExamIds: type === 'ml' ? [] : state.testComparison.mlExamIds,
          mpAnchor: type === 'mp' ? null : state.testComparison.mpAnchor,
          mlAnchor: type === 'ml' ? null : state.testComparison.mlAnchor
        }
      })),

    setFairnessOverride: v =>
      set(state => ({
        ...state,
        testComparison: { ...state.testComparison, fairnessOverride: v }
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
