'use client';
import { CSSProperties, useState } from 'react';
import { Slider } from '@mantine/core';
import { useDominantHue } from '@/app/hooks/useDominantHue';
import { ADJUSTMENTS, AdjustmentKey } from '@/lib/fetch';
import { ItemIcon } from '@/app/hooks/useItemIndex';
import { useEffectIds } from '@/app/hooks/useAvatar';
import { OutfitItem } from '@/types';
import styles from './ItemAdjust.module.scss';

// Slider bounds. The neutral value itself lives in ADJUSTMENTS — landing on it
// stores `undefined` rather than the number, which is what keeps the value out
// of the render URL and out of the exported JSON.
const RANGES: Record<
  AdjustmentKey,
  { min: number; max: number; step: number }
> = {
  hue: { min: 0, max: 360, step: 1 },
  saturation: { min: 0, max: 2, step: 0.05 },
  brightness: { min: 0, max: 2, step: 0.05 },
  contrast: { min: 0, max: 2, step: 0.05 },
  alpha: { min: 0, max: 1, step: 0.05 },
};

const LABELS: Record<AdjustmentKey, string> = {
  hue: 'Hue',
  saturation: 'Saturation',
  brightness: 'Brightness',
  contrast: 'Contrast',
  alpha: 'Opacity',
};

const KEYS = Object.keys(RANGES) as AdjustmentKey[];

const valueOf = (item: OutfitItem, key: AdjustmentKey) =>
  typeof item[key] === 'number' ? (item[key] as number) : ADJUSTMENTS[key];

/**
 * The vslot an item takes when it is set to stack.
 *
 * Empty, so it claims nothing and nothing it would have collided with gets
 * dropped
 */
const STACK_VSLOT = '';

export const isStacked = (item: OutfitItem) => item.vslot !== undefined;

/** Any non-neutral adjustment, a hidden layer, a stacked one, or a muted effect. Drives the "edited" marker. */
export const isAdjusted = (item: OutfitItem) =>
  !!item.depth ||
  item.visible === false ||
  item.effect === false ||
  isStacked(item) ||
  KEYS.some(k => valueOf(item, k) !== ADJUSTMENTS[k]);

// landing on neutral removes the key instead of storing the number
const patchFor = (key: AdjustmentKey, value: number) =>
  ({
    [key]: value === ADJUSTMENTS[key] ? undefined : value,
  }) as Partial<OutfitItem>;

const format = (key: AdjustmentKey, value: number) =>
  key === 'hue' ? `${Math.round(value)}°` : `${Math.round(value * 100)}%`;

/**
 * A spectrum starting at the item's own hue, so slider position 0 shows the
 * colour the item actually is and the thumb always sits on its current colour.
 * `hue` is a rotation, not an absolute — a track that starts at red would be
 * wrong for everything that isn't already red.
 */
const HUE_STOPS = 12;
const hueGradientFrom = (base: number) =>
  `linear-gradient(90deg, ${Array.from({ length: HUE_STOPS + 1 }, (_, i) => {
    const offset = (i * 360) / HUE_STOPS;
    return `hsl(${(base + offset) % 360} 100% 50%) ${(i / HUE_STOPS) * 100}%`;
  }).join(', ')})`;

/**
 * One slider. Dragging updates local state only; the outfit is committed on
 * release, so a drag costs one render request instead of one per step
 */
const Row = ({
  item,
  adjustment,
  disabled,
  max = RANGES[adjustment].max,
  onCommit,
}: {
  item: OutfitItem;
  adjustment: AdjustmentKey;
  disabled?: boolean;
  /** overrides the range's top, for the custom skin's brightness */
  max?: number;
  onCommit: (value: number) => void;
}) => {
  const [dragged, setDragged] = useState<number | null>(null);
  const committed = valueOf(item, adjustment);
  const shown = dragged ?? committed;
  const { min, step } = RANGES[adjustment];

  return (
    <div className={styles.row} data-disabled={disabled ? '' : undefined}>
      <div className={styles.rowHead}>
        <span>{LABELS[adjustment]}</span>
        <span
          className={styles.value}
          data-neutral={shown === ADJUSTMENTS[adjustment] ? '' : undefined}
        >
          {format(adjustment, shown)}
        </span>
      </div>
      <Slider
        value={shown}
        onChange={setDragged}
        onChangeEnd={value => {
          setDragged(null);
          onCommit(value);
        }}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        label={null}
        size='md'
        thumbSize={15}
        classNames={{
          root: styles.slider,
          track:
            adjustment === 'hue'
              ? `${styles.track} ${styles.hueTrack}`
              : styles.track,
          ...(adjustment === 'hue' && { bar: styles.hueBar }),
        }}
      />
    </div>
  );
};

const ItemAdjust = ({
  item,
  icon,
  onChange,
}: {
  item: OutfitItem;
  /** the item's tile in our own sheet, when we have one. the owner already
      looked it up, so it comes down rather than being fetched twice */
  icon?: ItemIcon | null;
  onChange: (patch: Partial<OutfitItem>) => void;
}) => {
  const hidden = item.visible === false;
  const stacked = isStacked(item);
  const depth = item.depth ?? 0;

  const effectIds = useEffectIds();
  const hasEffect = !!effectIds?.has(item.id);
  const effectOff = item.effect === false;
  // Read off the icon, which is the item in its unmodified colour
  const baseHue = useDominantHue(icon ? icon.sheet : null, icon);

  // `undefined` for every key, so a reset removes them rather than writing
  // neutral numbers the export would then carry around.
  const reset = () => {
    const patch: Partial<OutfitItem> = {
      visible: undefined,
      vslot: undefined,
      effect: undefined,
      depth: undefined,
    };
    for (const key of KEYS) patch[key] = undefined;
    onChange(patch);
  };

  return (
    <div
      className={styles.panel}
      style={
        baseHue === null
          ? undefined
          : ({ '--hue-gradient': hueGradientFrom(baseHue) } as CSSProperties)
      }
    >
      <p className={styles.name}>{item.name}</p>

      {KEYS.map(key => (
        <Row
          key={key}
          item={item}
          adjustment={key}
          // A hidden layer is forced to alpha 0 in the render URL, so a live
          // opacity slider would contradict what you see.
          disabled={hidden && key === 'alpha'}
          onCommit={value => onChange(patchFor(key, value))}
        />
      ))}

      {/* 0 is where the game draws it, and stores nothing */}
      <div className={styles.row}>
        <div className={styles.rowHead}>
          <span>Depth</span>
          <span className={styles.value} data-neutral={!depth ? '' : undefined}>
            {depth > 0 ? `+${depth}` : depth}
          </span>
        </div>
        <div className={styles.foot}>
          <button
            type='button'
            className={styles.footBtn}
            onClick={() => onChange({ depth: depth - 1 || undefined })}
          >
            Back
          </button>
          <button
            type='button'
            className={styles.footBtn}
            onClick={() => onChange({ depth: depth + 1 || undefined })}
          >
            Forward
          </button>
        </div>
      </div>

      <div className={styles.foot}>
        <button
          type='button'
          className={styles.footBtn}
          onClick={() => onChange({ visible: hidden ? undefined : false })}
          data-on={hidden ? '' : undefined}
        >
          {hidden ? 'Hidden' : 'Visible'}
        </button>
        {hasEffect && (
          <button
            type='button'
            className={styles.footBtn}
            onClick={() => onChange({ effect: effectOff ? undefined : false })}
            data-on={effectOff ? '' : undefined}
            id='effect-toggle'
          >
            {effectOff ? 'No FX' : 'FX'}
          </button>
        )}
        <button
          type='button'
          className={styles.footBtn}
          onClick={() => onChange({ vslot: stacked ? undefined : STACK_VSLOT })}
          data-on={stacked ? '' : undefined}
          title={
            'Stacked items hide nothing and nothing hides them, so pants show ' +
            'under an overall. Unstack a hair and its hat to have the hat cut it'
          }
        >
          {stacked ? 'Stacked' : 'Stack'}
          <span className={styles.footNote}>experimental</span>
        </button>
        <button
          type='button'
          className={styles.footBtn}
          onClick={reset}
          disabled={!isAdjusted(item)}
        >
          Reset
        </button>
      </div>
    </div>
  );
};

const TINT_KEYS: AdjustmentKey[] = ['hue', 'saturation', 'brightness'];

// The custom skin is dark blue. There's no icon to sample like items have, so
// this was measured off Body/2047.png with the same maths as useDominantHue
const CUSTOM_SKIN_HUE = 222;

// the skin starts that dark, so the items' 200% can't get it anywhere near pale
const CUSTOM_SKIN_MAX_BRIGHTNESS = 3;

/**
 * The custom skin's three sliders, what the game itself offers for it.
 *
 * Reads off the body, the owner writes each patch to the head as well
 */
export const SkinTint = ({
  body,
  onChange,
}: {
  body: OutfitItem;
  onChange: (patch: Partial<OutfitItem>) => void;
}) => (
  <div
    className={styles.panel}
    style={
      {
        '--hue-gradient': hueGradientFrom(CUSTOM_SKIN_HUE),
      } as CSSProperties
    }
  >
    {TINT_KEYS.map(key => (
      <Row
        key={key}
        item={body}
        adjustment={key}
        max={key === 'brightness' ? CUSTOM_SKIN_MAX_BRIGHTNESS : undefined}
        onCommit={value => onChange(patchFor(key, value))}
      />
    ))}
    <p className={styles.note}>bear in mind it&apos;s not 1:1 with in-game dyeing!</p>
  </div>
);

export default ItemAdjust;
