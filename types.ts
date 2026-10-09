/**
 * The outfit interchange format, shared with other MapleStory avatar
 * simulators — and, since it is also our in-app state shape, the single
 * source of truth for the character.
 *
 * It is essentially a serialization of the maplestory.io render URL:
 *   selectedItems -> the comma-joined item objects in the path
 *   top level     -> the query string (ears, flipX, name)
 * See `characterRenderUrl` in lib/fetch.ts for the mapping.
 *
 * Notes learned from real exports of other tools:
 * - `selectedItems` is keyed by maplestory.io subCategory ("Hat", "Face", ...).
 * - Body and Head are entries here, not just the top-level `skin` field. Head
 *   id is always Body id + 10000. Real exports carry a stale `skin` string
 *   (seen: "2012" alongside Body 2018), so the Body entry is authoritative.
 * - `region`/`version` are per item and genuinely mix within one outfit
 *   (GMS 268 + JMS 422 + KMST 1170 seen together). Ids are not portable
 *   across regions, so these must be preserved rather than normalized.
 * - Adjustments are inconsistently typed in the wild — both 0.35 and "0.35".
 *   We coerce to numbers on import; see `parseOutfit`.
 */
export interface OutfitItem {
  name: string;
  desc?: string;
  id: number;
  region: string;
  version: string;
  typeInfo: {
    overallCategory?: string;
    category?: string;
    subCategory?: string;
    lowItemId?: number;
    highItemId?: number;
  };
  noIcon?: boolean;
  skinName?: string;
  isCash?: boolean;
  requiredJobs?: string[];
  requiredLevel?: number;
  requiredGender?: number;
  // Adjustments. Neutral values are dropped when building the render URL.
  hue?: number;
  saturation?: number;
  brightness?: number;
  contrast?: number;
  alpha?: number;
  vslot?: string;
  /** clicks forward (+) or back (-) from where the game draws it, see placeLayers */
  depth?: number;
  visible?: boolean;
  /**
   * Draws the item's Effect.wz art, when it has any.
   */
  effect?: boolean;
  frame?: number;
  equipFrame?: number;
}

export type SelectedItems = Record<string, OutfitItem>;

/**
 * A speech balloon or a name tag hanging off one character.
 *
 * Deliberately not part of Outfit,  other tools have no idea what a balloon is, so passing it is pointless
 */
export type Caption = {
  on: boolean;
  text: string;
  /** keys into public/ui/<set>/<set>.json */
  style: string;
};

export interface Outfit {
  id: number;
  type: 'character';
  action: string;
  /**
   * Which weapon type the equipped weapon is carried as, eg 49 for the gun
   * carry, where it sits in the other arm.
   *
   * A cash weapon holds a whole stance set per weapon type it imitates, so this
   * picks the art rather than the pose. Absent is the weapon's own carry, which
   * is what every weapon that has only one does
   */
  carry?: number;
  /** Applied as `animationName` on the Face and Face Accessory layers. */
  emotion: string;
  /** Body item id as a string. Kept for compatibility; Body entry wins. */
  skin: string;
  /** Display scale only — we scale with CSS, never the API's `resize` bc then the fetched png would be heavier */
  zoom: number;
  frame: number;
  mercEars: boolean;
  illiumEars: boolean;
  highFloraEars: boolean;
  selectedItems: SelectedItems;
  visible: boolean;
  position: { x: number; y: number };
  fhSnap: boolean;
  flipX: boolean;
  name: string;
  includeBackground: boolean;
  animating: boolean;
  /** equipping into a taken slot adds an extra instead of replacing, see equipInto */
  frenzy?: boolean;
}

export type FaceEmoteOptions =
  | 'default'
  | 'blink'
  | 'smile'
  | 'cry'
  | 'bewildered'
  | 'angry'
  | 'hit'
  | 'troubled'
  | 'stunned'
  | 'vomit'
  | 'oops'
  | 'cheers'
  | 'chu'
  | 'wink'
  | 'pain'
  | 'glitter'
  | 'despair'
  | 'love'
  | 'shine'
  | 'blaze'
  | 'hum'
  | 'bowing'
  | 'hot'
  | 'dam'
  | 'qBlue';

export type EarsOptions = 'humanEars' | 'bigEars' | 'lefEars' | 'highlefEars';
