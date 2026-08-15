import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { toNumber } from '@/utils/number';

/**
 * A number field you can actually clear.
 *
 * The obvious implementation is broken:
 *
 *   value={amount}
 *   onChange={(e) => { const n = Number(e.target.value); if (n > 0) setAmount(n); }}
 *
 * Deleting the last digit yields '', which `Number` turns into 0, which fails
 * the guard, so state never updates and the controlled input snaps the old digit
 * straight back. The box becomes impossible to empty. The same trap swallows
 * intermediate states like '1.' or '-' while typing.
 *
 * Fixing that needs two things:
 *
 *  1. The raw string is what gets displayed; the number is derived from it.
 *  2. The component decides what empty *means* (`emptyValue`) and emits it.
 *
 * Point 2 is not optional. If the caller maps empty itself — `onValueChange={(v)
 * => setAmount(v ?? 0)}` — then an emptied box reports undefined, the caller
 * pushes 0 back down as the new `value`, and the field re-renders as "0". Same
 * unclearable field, different digit. The component has to know that 0 is the
 * expected echo of an empty box so it can leave the draft alone.
 */

/** How a value should be rendered into the text box. */
export const draftFor = (value: number | undefined): string =>
  value == null ? '' : String(value);

export interface DraftState {
  /** What the box shows. */
  draft: string;
  /** The last value this component emitted, used to detect outside changes. */
  emitted: number | undefined;
}

/** State after the user types. */
export const applyUserInput = (
  raw: string,
  emptyValue: number | undefined,
): DraftState => {
  const parsed = toNumber(raw);
  return { draft: raw, emitted: parsed ?? emptyValue };
};

/**
 * State after `value` arrives from the parent.
 *
 * Only replaces the draft when the incoming value differs from what we last
 * emitted — that is what separates "a preset button was clicked" from "the
 * parent is echoing back the change we just reported".
 */
export const applyExternalValue = (
  state: DraftState,
  value: number | undefined,
): DraftState =>
  value === state.emitted ? state : { draft: draftFor(value), emitted: value };

/** Clamp to bounds. Applied on blur only — see the comment at the call site. */
export const clampToBounds = (
  value: number,
  min: number | undefined,
  max: number | undefined,
): number => {
  let result = value;
  if (min != null && Number.isFinite(min) && result < min) result = min;
  if (max != null && Number.isFinite(max) && result > max) result = max;
  return result;
};

type InputProps = React.ComponentProps<typeof Input>;

export interface NumericInputProps
  extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'min' | 'max'> {
  value: number | undefined;
  onValueChange: (value: number | undefined) => void;
  /**
   * What an empty box reports. Defaults to `undefined` ("not specified"), which
   * suits optional filters. Pass 0 for amount fields.
   */
  emptyValue?: number | undefined;
  min?: number;
  max?: number;
}

export function NumericInput({
  value,
  onValueChange,
  emptyValue,
  min,
  max,
  onBlur,
  ...rest
}: NumericInputProps) {
  const [draft, setDraft] = useState(() => draftFor(value));
  const emitted = useRef<number | undefined>(value);

  useEffect(() => {
    const next = applyExternalValue({ draft, emitted: emitted.current }, value);
    if (next.draft !== draft) setDraft(next.draft);
    emitted.current = next.emitted;
    // Keyed on `value` alone on purpose: including `draft` would re-run on every
    // keystroke and fight the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => {
        const next = applyUserInput(event.target.value, emptyValue);
        setDraft(next.draft);
        emitted.current = next.emitted;
        onValueChange(next.emitted);
      }}
      onBlur={(event) => {
        // Clamp on blur, never while typing: clamping mid-keystroke would turn
        // "100" into "45" the moment the second character lands, in a field whose
        // max is 45.
        const parsed = toNumber(draft);
        if (parsed != null) {
          const clamped = clampToBounds(parsed, min, max);
          if (clamped !== parsed) {
            setDraft(String(clamped));
            emitted.current = clamped;
            onValueChange(clamped);
          }
        }
        onBlur?.(event);
      }}
    />
  );
}
