'use client';
import { FACE_PARTS, ItemManifest, WornItem } from '@/lib/avatar';
import { EffectManifest, WornEffect } from '@/lib/effects';
import { Outfit } from '@/types';
import { ASSET_BASE, SHEET_EXT } from '@/lib/assets';
import { baseSlot } from '@/lib/outfit';
import { useEffect, useState } from 'react';

/**
 * Loads the sheets and manifests for whatever a character is wearing.
 *
 * Only the items extract-avatar.lua has covered so far will resolve. Anything
 * else is skipped rather than faked, so a half dressed character means a
 * missing extraction and not a broken renderer
 */

const ROOT = ASSET_BASE;

/**
 * The equipped slot -> the folder its manifests are in.
 *
 * Keyed by the slot in `selectedItems`, which is the item's subCategory for
 * everything except the weapon tab. That one equips under a flat "Weapon"
 * because the API spreads weapons over sixteen subcategories and a character
 * only holds one, so the category is the fallback for anything that arrives
 * with a weapon type as its slot instead
 */
const FOLDERS: Record<string, string> = {
  Body: 'Body',
  Head: 'Head',
  Face: 'Face',
  Hair: 'Hair',
  Hat: 'Cap',
  Top: 'Coat',
  Overall: 'Longcoat',
  Bottom: 'Pants',
  Shoes: 'Shoes',
  Glove: 'Glove',
  Cape: 'Cape',
  Weapon: 'Weapon',
  'Face Accessory': 'Accessory',
  'Eye Decoration': 'Accessory',
  Earrings: 'Accessory',
};

const folderFor = (slot: string, category?: string) =>
  FOLDERS[slot] ?? (category?.includes('Weapon') ? 'Weapon' : null);

// body, head, face and hair have to match by name, they're the claim order.
// not unique, a frenzy extra shares its slot's part, layer names carry the id
const partFor = (slot: string) => slot.toLowerCase().replace(/\s+/g, '');

/**
 * The expression key to actually read, for a part that has expressions.
 *
 * Not just the emotion, because a face accessory does not carry the same set a
 * face does: 743 of the 778 have no `default` node at all, so asking for one
 * drew nothing and every moustache in the closet was invisible. Falling through
 * to blink is safe, every one of them has it and its first frame is resting pose
 */
const expressionFor = (manifest: ItemManifest, emotion: string) => {
  const has = manifest.frames;
  if (has[emotion]) return emotion;
  if (has.default) return 'default';
  if (has.blink) return 'blink';
  return Object.keys(has)[0];
};

export type AvatarMeta = { zmap: string[]; smap: Record<string, string> };

// module level, so remounting or switching character doesn't refetch
let metaOnce: Promise<AvatarMeta> | null = null;
let effectIdsOnce: Promise<Set<number>> | null = null;
const manifests = new Map<string, Promise<ItemManifest | null>>();
const effectManifests = new Map<number, Promise<EffectManifest | null>>();
const sheets = new Map<string, Promise<HTMLImageElement | null>>();

/**
 * The ids that have an effect at all, fetched once.
 *
 * 1664 of 52,724, so asking per worn item would be a 404 nearly every time.
 * An empty set on failure means effects quietly do not draw, which is the
 * right way round: the character still renders
 */
const loadEffectIds = () => {
  effectIdsOnce ??= fetch(`${ROOT}/Effect/index.json`)
    .then(r => (r.ok ? (r.json() as Promise<number[]>) : []))
    .then(ids => new Set(ids))
    .catch(() => new Set<number>());
  return effectIdsOnce;
};

/**
 * The adjust popover only offers an effect toggle on the items that have one
 */
export const useEffectIds = () => {
  const [ids, setIds] = useState<Set<number> | null>(null);
  useEffect(() => {
    let stale = false;
    loadEffectIds().then(set => {
      if (!stale) setIds(set);
    });
    return () => {
      stale = true;
    };
  }, []);
  return ids;
};

const loadEffect = (id: number) => {
  let hit = effectManifests.get(id);
  if (!hit) {
    hit = fetch(`${ROOT}/Effect/${id}.json`)
      .then(r => (r.ok ? (r.json() as Promise<EffectManifest>) : null))
      .catch(() => null);
    effectManifests.set(id, hit);
  }
  return hit;
};

const loadManifest = (folder: string, file: string) => {
  const url = `${ROOT}/${folder}/${file}.json`;
  let hit = manifests.get(url);
  if (!hit) {
    hit = fetch(url)
      .then(r => (r.ok ? (r.json() as Promise<ItemManifest>) : null))
      .catch(() => null);
    manifests.set(url, hit);
  }
  return hit;
};

/**
 * The item as carried, which for most items is just the item.
 *
 * A weapon keyed by weapon type has one sheet per carry, the item's own +
 * `<id>-<type>` beside it, so a gun carry is a different file rather than a
 * different pose. `types` says the art exists in wz; whether it has been
 * extracted yet is what the fetch answers, and a miss falls back to the normal
 * carry rather than leaving the character holding nothing
 */
const loadCarried = async (folder: string, id: number, carry?: number) => {
  const own = await loadManifest(folder, String(id));
  if (!own || !carry || carry === own.type) return { manifest: own, file: String(id) };
  if (!own.types?.includes(carry)) return { manifest: own, file: String(id) };
  const file = `${id}-${carry}`;
  const variant = await loadManifest(folder, file);
  return variant ? { manifest: variant, file } : { manifest: own, file: String(id) };
};

const loadSheet = (url: string) => {
  let hit = sheets.get(url);
  if (!hit) {
    hit = new Promise<HTMLImageElement | null>(resolve => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    sheets.set(url, hit);
  }
  return hit;
};

export type LoadedAvatar = {
  meta: AvatarMeta;
  worn: WornItem[];
  /** the worn items that also carry an Effect appearance */
  effects: WornEffect[];
  images: Map<string, HTMLImageElement>;
  /** slots we have no extraction for yet, so the ui can say so */
  missing: string[];
};

const useAvatar = (outfit: Outfit, enabled: boolean) => {
  const [loaded, setLoaded] = useState<LoadedAvatar | null>(null);

  // the items, not the whole outfit. an adjustment or a pose change shouldn't
  // send us back to the network.
  //
  // vslot is in here because it is not an adjustment: hue and opacity are
  // applied when drawing, but vslot decides which layers exist at all, so it
  // has to reach buildAvatar through `worn`
  const key = Object.entries(outfit.selectedItems)
    .map(
      ([slot, item]) =>
        // effect is in here for the same reason vslot is. it decides whether
        // the effect is fetched at all, not how it is painted
        // depth too, it reorders layers rather than painting them
        `${slot}:${item?.id}:${item?.vslot ?? ''}:${item?.effect === false ? 'x' : ''}:${item?.depth ?? ''}`,
    )
    .sort()
    .join(',');

  useEffect(() => {
    if (!enabled) return;
    let stale = false;

    metaOnce ??= fetch(`${ROOT}/meta.json`).then(r => r.json());

    (async () => {
      const meta = await metaOnce!;

      // collected positionally rather than pushed.
      //
      // a push sits after the await, so `worn` came out in whatever order the
      // manifests happened to come back, which is the network's business and
      // not ours. placeLayers sorts on the z name and that sort is stable, so
      // two garments sharing a z name keep their `worn` order
      const entries = Object.entries(outfit.selectedItems);
      const built = await Promise.all(
        entries.map(async ([slot, item]) => {
          if (!item) return null;
          // a frenzy extra renders as the slot it came from
          const base = baseSlot(slot);
          const folder = folderFor(base, item.typeInfo?.category);
          if (!folder) return null;
          const { manifest, file } = await loadCarried(folder, item.id, outfit.carry);
          if (!manifest) return { slot, item: null };
          const part = partFor(base);
          return {
            slot,
            item: {
              part,
              manifest,
              sheetUrl: `${ROOT}/${folder}/${file}${SHEET_EXT}`,
              // the face and the face accessory are keyed by expression,
              // everything else by pose
              stance: FACE_PARTS.has(part)
                ? expressionFor(manifest, outfit.emotion)
                : undefined,
              // set by the stack toggle, and carried in an imported outfit
              vslot: item.vslot,
              depth: item.depth,
            } as WornItem,
          };
        }),
      );

      const worn: WornItem[] = [];
      const missing: string[] = [];
      for (const b of built) {
        if (!b) continue;
        if (b.item) worn.push(b.item);
        else missing.push(b.slot);
      }

      // the effects, for whichever worn items have one. an item's effect is
      // its whole appearance when its Character.wz art is a 1x1 placeholder,
      // so this is not decoration
      const haveEffect = await loadEffectIds();
      // switched off per item
      const muted = new Set(
        Object.values(outfit.selectedItems)
          .filter(i => i?.effect === false)
          .map(i => i.id),
      );
      const effectIds = Array.from(new Set(worn.map(w => w.manifest.id))).filter(
        id => haveEffect.has(id) && !muted.has(id),
      );
      // positional for the same reason as `worn` above
      const effectManifests = await Promise.all(effectIds.map(id => loadEffect(id)));
      const wornEffects: WornEffect[] = [];
      effectManifests.forEach((manifest, i) => {
        if (manifest) {
          wornEffects.push({
            manifest,
            sheetUrl: `${ROOT}/Effect/${effectIds[i]}${SHEET_EXT}`,
          });
        }
      });

      // one load per sheet, not per layer. Array.from rather than spreading a
      // Set, the tsconfig targets es5
      const urls = Array.from(
        new Set([...worn.map(w => w.sheetUrl), ...wornEffects.map(e => e.sheetUrl)]),
      );
      const imgs = await Promise.all(
        urls.map(async url => [url, await loadSheet(url)] as const),
      );
      const images = new Map<string, HTMLImageElement>();
      for (const [url, img] of imgs) if (img) images.set(url, img);

      if (!stale) setLoaded({ meta, worn, effects: wornEffects, images, missing });
    })().catch(() => {
      // nothing extracted yet, the api render is still there
      metaOnce = null;
    });

    return () => {
      stale = true;
    };
    // carry is in here bc it decides which sheet is fetched, the same way vslot
    // decides which layers exist. it is not something the canvas can apply
  }, [enabled, key, outfit.emotion, outfit.carry, outfit.selectedItems]);

  return loaded;
};

export default useAvatar;
