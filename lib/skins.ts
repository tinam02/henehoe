import { Outfit, OutfitItem } from '@/types';

// Highest known body id with a real skin. Bump as MapleStory adds new ones.
// no name data for skins exists anywhere we can read, so this list is verified
// by hand, scrolling the picker and comparing swatches.
export const MAX_SKIN_ID = 2048;
export const MIN_SKIN_ID = 2000;

// Head ids mirror the body skin id offset by this much.
export const HEAD_ID_OFFSET = 10000;

// Ids that don't render a real skin
// VISUAL VERIFICATION BY DEV by pressing the skin buttons, add to this list as you find more
const SKIP_SKIN_IDS = new Set<number>([
  2006, 2007, 2008, 2014, 2017, 2024, 2031, 2041, 2042, 2044,
]);

export const SKIN_IDS = Array.from(
  { length: MAX_SKIN_ID - MIN_SKIN_ID + 1 },
  (_, i) => MIN_SKIN_ID + i,
).filter(id => !SKIP_SKIN_IDS.has(id));

// VISUAL VERIFICATION BY DEV Fill these names as you visually identify each
export const SKIN_NAMES: Record<number, string> = {
  2000: 'Light',
  2001: 'Tan',
  2002: 'Dark',
  2003: 'Pale',
  2004: 'Blue Gray',
  2005: 'Green',
  2009: 'Ghostly',
  2010: 'Fair',
  2011: 'Clay',
  2012: 'Mercedes',
  2013: 'Pale Gray',
  2015: 'Soft',
  2016: 'Blushing',
  2018: 'Peach',
  2019: 'Blushing Peach',
  2020: 'Cow',
  2021: 'Pink Cow',
  2022: 'Brown Cow',
  2023: 'Tan Cow',
  2025: 'Gold',
  2026: 'Silver',
  2027: 'Bronze',
  2028: 'Spinel',
  2029: 'Amethyst',
  2030: 'Athletic',
  2032: 'Apatite',
  2033: 'Apricot',
  2034: 'It was Summer',
  2035: 'Pink Bean',
  2036: 'Yeti',
  2037: 'Slime',
  2038: 'Mushroom',
  2039: 'Rock Spirit',
  2040: 'Pepe',
  2043: '',
  2045: 'Panda',
  2046: 'Cat',
  2047: 'Custom',
  2048: 'Hessonite',
};

// The one skin the game lets you tint
export const CUSTOM_SKIN_ID = 2047;

export const skinLabel = (id: number) => SKIN_NAMES[id] || String(id);

// Name as other simulators write it in exported JSON ("Soft Lavender Skin").
// Undefined for ids we haven't identified, so export can omit `skinName`.
export const skinFullName = (id: number): string | undefined =>
  SKIN_NAMES[id] ? `${SKIN_NAMES[id]} Skin` : undefined;

// drops the custom skin's tint
const untinted = ({ hue, saturation, brightness, ...item }: OutfitItem) => item;

/**
 * A bare body and head in one skin, for a swatch.
 *
 * Only the skin being worn keeps its tint, or every other swatch would wear it too
 */
export const skinSwatchOutfit = (outfit: Outfit, id: number): Outfit => {
  const body = outfit.selectedItems.Body as OutfitItem;
  const head = outfit.selectedItems.Head as OutfitItem;
  const keep = (item: OutfitItem) => (body.id === id ? item : untinted(item));
  return {
    ...outfit,
    selectedItems: {
      Body: { ...keep(body), id },
      Head: { ...keep(head), id: id + HEAD_ID_OFFSET },
    },
    emotion: 'default',
    action: 'stand1',
    frame: 0,
    animating: false,
    flipX: false,
  };
};
