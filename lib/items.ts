/**
 * The catalogue, read from data/items.json at build time.
 *
 * Server only. Nothing here is allowed into a client bundle: the digest is
 * 7.6 MB and the whole point of the item pages is that the facts are already
 * in the html by the time anything ships.
 *
 * scripts/build-item-pages.mjs writes the file. If it is missing the routes
 * generate nothing rather than failing the build, which is what you want when
 * someone clones this without the extraction
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_BASE, asSheet } from './assets';
import { CATEGORIES, byKey } from './categories.mjs';

export type Category = {
  key: string;
  slot: string;
  folder: string;
  title: string;
  noun: string;
  ids?: { from: number; to: number };
  colour?: number;
};

/** the icon's width and height, so an img can reserve the space */
export type IconRect = [number, number];

export type Variant = { id: number; ic: IconRect; name?: string };

export type Item = {
  id: number;
  /** empty for the 151 items the client never translated */
  n: string;
  slug: string;
  c: string;
  cash: 0 | 1;
  ic: IconRect;
  v?: Variant[];
  /** the slot the item equips into, as wz spells it */
  is?: string | null;
  /** every slot it occupies, which is how an overall covers two */
  vs?: string | null;
  pieces?: number;
  z?: string[];
  fx?: 1;
  set?: string;
};

type Digest = {
  built: string;
  cats: { key: string; ids: number; pages: number }[];
  items: Item[];
};

const EMPTY: Digest = { built: '1970-01-01', cats: [], items: [] };

// read once per process. next runs static generation across several workers and
// each one pays for it separately, so this is 7.6 MB parsed a handful of times
// rather than 26,322
let digest: Digest | null = null;

const load = (): Digest => {
  if (digest) return digest;
  const file = join(process.cwd(), 'data', 'items.json');
  if (!existsSync(file)) {
    console.warn(
      'data/items.json missing, no item pages will be built. run node scripts/build-item-pages.mjs',
    );
    digest = EMPTY;
    return digest;
  }
  digest = JSON.parse(readFileSync(file, 'utf8')) as Digest;
  return digest;
};

export const categories = (): Category[] => CATEGORIES as Category[];

export const categoryByKey = (key: string): Category | null =>
  byKey(key) as Category | null;

export const builtOn = () => load().built;

export const allItems = (): Item[] => load().items;

/** how many pages a category has, for the hub copy */
export const categoryCounts = () => load().cats;

// key -> items, built on first ask. the hubs and the sitemaps both walk
// categories, and filtering 26k rows 13 times over is silly when the digest is
// already sorted by category
let grouped: Map<string, Item[]> | null = null;

export const itemsIn = (key: string): Item[] => {
  if (!grouped) {
    grouped = new Map();
    for (const it of load().items) {
      const list = grouped.get(it.c);
      if (list) list.push(it);
      else grouped.set(it.c, [it]);
    }
  }
  return grouped.get(key) ?? [];
};

let bySlug: Map<string, Item> | null = null;

export const findItem = (key: string, slug: string): Item | null => {
  if (!bySlug) {
    bySlug = new Map();
    for (const it of load().items) bySlug.set(`${it.c}/${it.slug}`, it);
  }
  return bySlug.get(`${key}/${slug}`) ?? null;
};

/**
 * An item's own icon, cut out of the packed sheet at build time.
 *
 * The closet crops the sheets because it shows a thousand items off one file.
 * A page shows one item, and Cap-icons-0 is 1.8 MB, so scripts/build-item-
 * pages.mjs writes every icon out separately and a page pulls half a kilobyte
 */
export const iconUrl = (id: number) => asSheet(`${ASSET_BASE}/items/${id}.png`);

/**
 * The open graph share card for an item page.
 *
 * Not asSheet, deliberately. These are drawn by tools/ogcards and go's x/image
 * reads webp without being able to write it, so the cards are png. Nothing is
 * lost by that: every scraper takes png, and a card is flat colour over pixel
 * art so it indexes down to about 3 kB anyway.
 *
 * Relative on purpose too. metadataBase in app/layout.tsx makes it absolute,
 * which is the one thing og:image actually requires
 */
export const ogUrl = (id: number) => `${ASSET_BASE}/og/${id}.png`;

/**
 * A whole number scale that fits an icon in a box.
 *
 * Whole numbers only. These are 30 pixel sprites drawn at 4x, and a fractional
 * scale puts a soft edge on art that is meant to have hard ones
 */
export const fitScale = (w: number, h: number, box: number) =>
  Math.max(1, Math.floor(box / Math.max(w || 1, h || 1)));

/** what shows on the page, and what a nameless item falls back to */
export const titleOf = (item: Item) => item.n || `Item ${item.id}`;

/**
 * An item with no english name has nothing to rank for.
 *
 * 151 of them, all still browsable and still wearable, just kept out of the
 * sitemap and marked noindex so they are not 151 blank pages in the index
 */
export const isIndexable = (item: Item) => !!item.n;

// ---------------------------------------------------------------- facts

/**
 * The slot codes, read off the extraction rather than off a wiki.
 *
 * Every one of these was confirmed by grouping the digest: `hat` items carry
 * islot Cp, `overall` items carry MaPn, and so on. The H codes are the hair's
 * own sections, which is why a hat listing several of them is a hat that eats
 * your hairstyle
 */
const SLOT_NAMES: Record<string, string> = {
  Cp: 'hat',
  Hr: 'hair',
  Fc: 'face',
  Ay: 'eye accessory',
  Af: 'face accessory',
  Ae: 'earrings',
  Ma: 'top',
  Pn: 'bottom',
  So: 'shoes',
  Gv: 'gloves',
  Gl: 'gloves',
  Sr: 'cape',
  Wp: 'weapon',
  Si: 'shield',
};

/** a vslot string is 2 character codes run together */
export const slotCodes = (vslot?: string | null) =>
  vslot ? (vslot.match(/[A-Z][a-z0-9]/g) ?? []) : [];

/** how much of the hairstyle a hat leaves showing */
export const hairCoverage = (item: Item): 'all' | 'some' | null => {
  if (item.c !== 'hat') return null;
  const hair = slotCodes(item.vs).filter(c => /^H[0-9a-z]$/.test(c));
  if (!hair.length) return null;
  // the full set is H1 to H6 plus Hf, Hb, Hs and Hx. anything short of that
  // leaves part of the hairstyle visible, which is the thing people actually
  // want to know before they buy a hat
  return hair.length >= 9 ? 'all' : 'some';
};

/** the other slots an item takes over, named, minus its own */
export const alsoOccupies = (item: Item) => {
  const own = item.c === 'overall' ? ['Ma', 'Pn'] : slotCodes(item.is);
  const primary = own[0];
  return slotCodes(item.vs)
    .filter(c => c !== primary && !/^H[0-9a-z]$/.test(c) && SLOT_NAMES[c])
    .map(c => SLOT_NAMES[c]);
};

/** whether any of the item's sprites are drawn behind the character */
export const drawsBehind = (item: Item) =>
  !!item.z?.some(z => /back|Below/i.test(z));

// ---------------------------------------------------------------- copy

const list = (parts: string[]) =>
  parts.length < 2
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/**
 * The sentence under the heading, and the meta description.
 *
 * Built out of the item's own facts rather than a template with the name
 * dropped in, so a hat that swallows your hairstyle and a hat that sits on top
 * of it do not get the same paragraph. That is the whole difference between
 * 26,317 pages and 26,317 copies of one page
 */
export const describe = (item: Item) => {
  const cat = categoryByKey(item.c);
  const noun = cat?.noun ?? 'item';
  const kind = item.cash ? `cash shop ${noun}` : `${noun}`;

  const bits: string[] = [];

  const colours = item.v?.length ?? 0;
  if (colours > 1) {
    const named = item.v?.map(v => v.name).filter(Boolean) as string[];
    bits.push(
      named.length === colours
        ? `It comes in ${colours} colours: ${list(named)}.`
        : `It comes in ${colours} colour variants.`,
    );
  }

  const hair = hairCoverage(item);
  if (hair === 'all') bits.push('It hides the hairstyle completely.');
  else if (hair === 'some') bits.push('It covers part of the hairstyle.');

  const also = alsoOccupies(item);
  if (also.length) bits.push(`It takes up the ${list(also)} slot as well.`);

  if (item.fx) {
    bits.push('It carries its own animated effect, which can be turned off.');
  } else if (drawsBehind(item)) {
    bits.push('Part of it is drawn behind the character.');
  }

  return {
    lead: `${titleOf(item)} is a ${kind} in MapleStory, item ID ${item.id}.`,
    detail: bits.join(' '),
  };
};

/** one line, for <meta name=description> */
export const metaDescription = (item: Item) => {
  const { lead, detail } = describe(item);
  const tail = 'Try it on a character and see how it looks, free, in the browser.';
  return [lead, detail, tail].filter(Boolean).join(' ').slice(0, 300);
};

// ---------------------------------------------------------------- related

let sets: Map<string, Item[]> | null = null;

/**
 * Other items whose name starts the same way.
 *
 * wz ships no set list for cosmetics, so this is a name prefix and nothing
 * more. It is still the strongest link on the page: it is the only thing
 * pointing sideways into other categories, and a hat that links to the rest of
 * its outfit is a hat page worth landing on
 */
export const sameSet = (item: Item, limit = 6): Item[] => {
  if (!item.set) return [];
  if (!sets) {
    sets = new Map();
    for (const it of load().items) {
      if (!it.set) continue;
      const list = sets.get(it.set);
      if (list) list.push(it);
      else sets.set(it.set, [it]);
    }
  }
  const all = (sets.get(item.set) ?? []).filter(i => i.id !== item.id);
  // a different category first, so a big set does not fill the strip with 12
  // more hats when it also has the cape and the shoes
  const other = all.filter(i => i.c !== item.c);
  const same = all.filter(i => i.c === item.c);
  return [...other, ...same].slice(0, limit);
};

/**
 * The items either side in the category, so every page has a way onward.
 *
 * Kept short. Every card costs about 700 bytes across the html and the flight
 * payload next writes beside it, and at 26,317 pages a card nobody clicks is
 * 18 MB of deploy. Six each way is enough to crawl through and enough to
 * browse with
 */
export const neighbours = (item: Item, span = 3) => {
  const list = itemsIn(item.c);
  const i = list.findIndex(x => x.id === item.id);
  if (i < 0) return [];
  return [
    ...list.slice(Math.max(0, i - span), i),
    ...list.slice(i + 1, i + 1 + span),
  ];
};

// ---------------------------------------------------------------- urls

export const itemPath = (item: Item) => `/items/${item.c}/${item.slug}`;
export const categoryPath = (key: string, page = 1) =>
  page > 1 ? `/items/${key}/page/${page}` : `/items/${key}`;

/** how many items a hub page lists */
export const PAGE_SIZE = 60;

export const pageCount = (key: string) =>
  Math.max(1, Math.ceil(itemsIn(key).length / PAGE_SIZE));
