import { describe, expect, it } from 'vitest';

import { deriveState } from '../index';

// ---------------------------------------------------------------------------
// deriveState: URL construction + state mapping
// ---------------------------------------------------------------------------

describe('deriveState', () => {
  it('returns unavailable when url is empty string', () => {
    expect(deriveState('', false)).toBe('unavailable');
  });

  it('returns unavailable when url is empty regardless of loadError', () => {
    expect(deriveState('', true)).toBe('unavailable');
  });

  it('returns ready when url is set and no load error', () => {
    expect(deriveState('http://10.254.0.1:30091/', false)).toBe('ready');
  });

  it('returns error when url is set but loadError is true', () => {
    expect(deriveState('http://10.254.0.1:30091/', true)).toBe('error');
  });

  it('never returns ready for an empty url even when loadError is false', () => {
    const result = deriveState('', false);
    expect(result).not.toBe('ready');
    expect(result).not.toBe('loading');
  });
});
