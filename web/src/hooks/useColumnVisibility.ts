import { useCallback, useState } from 'react';

// ----------------------------------------------------------------------
// Persisted per-column visibility for data tables (R10). State is keyed in
// localStorage so a viewer's chosen columns survive reloads. Unknown/legacy
// keys in storage are ignored; new default keys are always honored so adding a
// column later does not require clearing storage.
// ----------------------------------------------------------------------

export type ColumnVisibility = {
  /** Current visibility map (column key → shown?). */
  visible: Record<string, boolean>;
  /** Flip one column on/off (persists immediately). */
  toggle: (key: string) => void;
  /** Convenience read — true when the column is shown (defaults to true). */
  isVisible: (key: string) => boolean;
};

const storageKey = (key: string) => `omc.colvis.${key}`;

function readPersisted(
  key: string,
  defaults: Record<string, boolean>,
): Record<string, boolean> {
  const base = { ...defaults };
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return base;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    for (const k of Object.keys(base)) {
      if (typeof saved[k] === 'boolean') base[k] = saved[k] as boolean;
    }
  } catch {
    // Corrupt/blocked storage → fall back to defaults, never throw.
  }
  return base;
}

export function useColumnVisibility(
  key: string,
  defaults: Record<string, boolean>,
): ColumnVisibility {
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    readPersisted(key, defaults),
  );

  const toggle = useCallback(
    (col: string) => {
      setVisible(prev => {
        const next = { ...prev, [col]: !prev[col] };
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(storageKey(key), JSON.stringify(next));
          } catch {
            // Storage unavailable (private mode / quota) → keep in-memory state.
          }
        }
        return next;
      });
    },
    [key],
  );

  const isVisible = useCallback((col: string) => visible[col] !== false, [visible]);

  return { visible, toggle, isVisible };
}

export default useColumnVisibility;
