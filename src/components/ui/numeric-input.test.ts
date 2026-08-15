import { describe, expect, it } from 'vitest';
import {
  applyExternalValue,
  applyUserInput,
  clampToBounds,
  draftFor,
  type DraftState,
} from '@/components/ui/numeric-input';

/**
 * The component is a thin wrapper; its correctness lives entirely in the
 * draft/value handshake. Get it wrong in either direction and the field is
 * either unclearable (the original bug) or ignores preset buttons.
 */
describe('draftFor', () => {
  it('renders an absent value as an empty box, not "0" or "undefined"', () => {
    expect(draftFor(undefined)).toBe('');
  });

  it('renders zero as zero', () => {
    expect(draftFor(0)).toBe('0');
  });

  it('renders numbers plainly, without grouping', () => {
    // Grouping separators would be re-parsed as junk on the next keystroke.
    expect(draftFor(500000)).toBe('500000');
    expect(draftFor(12.5)).toBe('12.5');
  });
});

describe('applyUserInput', () => {
  it('keeps the raw text exactly as typed', () => {
    // Intermediate states must survive: re-rendering '1.' as '1' would stop the
    // user ever typing a decimal.
    expect(applyUserInput('1.', 0).draft).toBe('1.');
    expect(applyUserInput('-', 0).draft).toBe('-');
    expect(applyUserInput(' 42 ', 0).draft).toBe(' 42 ');
  });

  it('emits the empty value for an empty box', () => {
    expect(applyUserInput('', 0).emitted).toBe(0);
    expect(applyUserInput('', undefined).emitted).toBeUndefined();
    expect(applyUserInput('   ', 0).emitted).toBe(0);
  });

  it('emits the empty value for text that is not a number yet', () => {
    expect(applyUserInput('-', 0).emitted).toBe(0);
    expect(applyUserInput('abc', undefined).emitted).toBeUndefined();
  });

  it('emits the parsed number otherwise', () => {
    expect(applyUserInput('500000', 0).emitted).toBe(500000);
    expect(applyUserInput('0', undefined).emitted).toBe(0);
    expect(applyUserInput('12.5', 0).emitted).toBe(12.5);
  });
});

describe('applyExternalValue', () => {
  const state = (draft: string, emitted: number | undefined): DraftState => ({ draft, emitted });

  it('ignores the parent echoing back what we just emitted', () => {
    // This is the fix for the unclearable field. The box is empty, we reported 0,
    // and the parent hands 0 straight back. Rendering it would show "0" in a box
    // the user just emptied.
    const before = state('', 0);
    expect(applyExternalValue(before, 0)).toBe(before);
  });

  it('ignores the echo for an optional field too', () => {
    const before = state('', undefined);
    expect(applyExternalValue(before, undefined)).toBe(before);
  });

  it('adopts a value genuinely set from outside', () => {
    // A preset button.
    expect(applyExternalValue(state('100000', 100000), 500000)).toEqual({
      draft: '500000',
      emitted: 500000,
    });
  });

  it('adopts an outside value even when the box is empty', () => {
    expect(applyExternalValue(state('', 0), 500000)).toEqual({
      draft: '500000',
      emitted: 500000,
    });
  });

  it('does not disturb an in-progress decimal that already round-trips', () => {
    const before = state('12.50', 12.5);
    expect(applyExternalValue(before, 12.5)).toBe(before);
  });
});

describe('clampToBounds', () => {
  it('clamps to either bound', () => {
    expect(clampToBounds(-5, 0, 100)).toBe(0);
    expect(clampToBounds(150, 0, 100)).toBe(100);
    expect(clampToBounds(50, 0, 100)).toBe(50);
  });

  it('ignores absent bounds', () => {
    expect(clampToBounds(-5, undefined, undefined)).toBe(-5);
    expect(clampToBounds(1e9, 0, undefined)).toBe(1e9);
  });
});

describe('full handshake', () => {
  /** Replays exactly what the component does across a sequence of keystrokes. */
  const simulate = (keystrokes: string[], emptyValue: number | undefined) => {
    let state: DraftState = { draft: draftFor(100000), emitted: 100000 };

    for (const raw of keystrokes) {
      state = applyUserInput(raw, emptyValue);
      // The parent re-renders with whatever we emitted.
      state = applyExternalValue(state, state.emitted);
    }

    return state;
  };

  it('lets an amount field be emptied and report 0', () => {
    // Backspacing 100000 away entirely — the behaviour originally reported broken.
    const result = simulate(['10000', '1000', '100', '10', '1', ''], 0);
    expect(result.draft).toBe('');
    expect(result.emitted).toBe(0);
  });

  it('lets an optional field be emptied and report undefined', () => {
    const result = simulate(['1', ''], undefined);
    expect(result.draft).toBe('');
    expect(result.emitted).toBeUndefined();
  });

  it('accepts a fresh value typed after clearing', () => {
    const result = simulate(['', '5', '50', '500'], 0);
    expect(result.draft).toBe('500');
    expect(result.emitted).toBe(500);
  });

  it('survives clearing twice in a row', () => {
    const result = simulate(['', ''], 0);
    expect(result.draft).toBe('');
    expect(result.emitted).toBe(0);
  });

  it('still adopts a preset after the box was cleared', () => {
    let state = simulate([''], 0);
    state = applyExternalValue(state, 500000);
    expect(state.draft).toBe('500000');
  });
});
