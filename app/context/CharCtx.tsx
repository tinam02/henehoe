'use client';
import { Caption, Outfit, OutfitItem } from '@/types';
import {
  createOutfit,
  DEFAULT_SKIN_ID,
  equipInto,
  skinEntries,
  skinIdOf,
  withSkin,
} from '@/lib/outfit';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 Characters
 *
 * Everything that only cares about one character still reads `outfit`, which is the active one. That's what keeps the closet, the pickers and export off this file entirely
 */

export { DEFAULT_SKIN_ID };

const STORAGE_KEY = 'chars';
// the single char key this replaced, read once so a saved one survives
const SOLO_KEY = 'outfit';
// pre-unification keys, older still
const LEGACY_ITEMS_KEY = 'selectedItems';
const LEGACY_SKIN_KEY = 'skinId';
export const MAX_CHARS = 8;

const NO_CAPTION: Caption = { on: false, text: '', style: '0' };
const NO_TAG: Caption = { on: false, text: '', style: '3' };

type Captions = { speech: Caption; nametag: Caption };

type CharContextValue = {
  /** every character, in the order they were added */
  chars: Outfit[];
  activeId: number;
  setActiveId: (id: number) => void;
  /** appends a default character and makes it active. no-op at MAX_CHARS */
  addChar: () => void;
  /** copies one, offset so it doesn't land exactly on top of the original */
  duplicateChar: (id: number) => void;
  /**
   * Adds an imported outfit to the cast and makes it active.
   *
   * A character arrives rather than replacing whoever was selected, since an
   * import is nearly always someone new and overwriting the character you had
   * open is not undoable. False when the cast is full
   */
  importChar: (outfit: Outfit) => boolean;
  /** removing the last one leaves a fresh default, never an empty stage */
  removeChar: (id: number) => void;
  renameChar: (id: number, name: string) => void;

  // everything below is the active character, same shape as before the cast
  outfit: Outfit;
  setOutfit: React.Dispatch<React.SetStateAction<Outfit>>;
  equip: (slot: string, item: OutfitItem) => void;
  unequip: (slot: string) => void;
  /** Merge a partial into one equipped item */
  adjustItem: (slot: string, patch: Partial<OutfitItem>) => void;
  skinId: number;
  setSkinId: (id: number) => void;
  animating: boolean;
  toggleAnimating: () => void;
  emotion: string;
  setEmotion: (emotion: string) => void;

  // a balloon and a tag per character, kept beside Outfit rather than in it so the interchange format stays exactly what other tools expect
  captionsOf: (id: number) => Captions;
  setCaption: (
    id: number,
    kind: 'speech' | 'nametag',
    patch: Partial<Caption>,
  ) => void;

  /**
   * Selects a character and asks the Stage to pan to her.
   *
   * Separate from setActiveId because selecting happens for all sorts of
   * reasons, including grabbing someone on the stage, and re-centring the map
   * under a drag in progress would be horrible
   */
  focusChar: (id: number) => void;
  /**
   * The standing focus request, if any. The counter is the point: asking for
   * the same character twice has to read as two requests, or the second click
   * on someone already selected would do nothing
   */
  focusReq: { id: number; n: number } | null;

  /** False until localStorage has been read, so nothing overwrites it early. */
  hydrated: boolean;
};

const FALLBACK = createOutfit(0);

export const CharContext = createContext<CharContextValue>({
  chars: [FALLBACK],
  activeId: FALLBACK.id,
  setActiveId: () => {},
  addChar: () => {},
  duplicateChar: () => {},
  importChar: () => false,
  removeChar: () => {},
  renameChar: () => {},
  outfit: FALLBACK,
  setOutfit: () => {},
  equip: () => {},
  unequip: () => {},
  adjustItem: () => {},
  skinId: DEFAULT_SKIN_ID,
  setSkinId: () => {},
  animating: FALLBACK.animating,
  toggleAnimating: () => {},
  emotion: FALLBACK.emotion,
  setEmotion: () => {},
  captionsOf: () => ({ speech: NO_CAPTION, nametag: NO_TAG }),
  setCaption: () => {},
  focusChar: () => {},
  focusReq: null,
  hydrated: false,
});

/** Rebuilds an outfit from the old two-key localStorage layout. */
function migrateLegacy(now: number): Outfit | null {
  const rawItems = localStorage.getItem(LEGACY_ITEMS_KEY);
  if (!rawItems) return null;
  try {
    const legacy = JSON.parse(rawItems) as Record<string, any>;
    const skinId =
      Number(localStorage.getItem(LEGACY_SKIN_KEY)) || DEFAULT_SKIN_ID;
    const selectedItems = skinEntries(skinId);
    for (const [slot, item] of Object.entries(legacy)) {
      // Legacy items keyed the id as `itemId` and had no region/version.
      if (!item?.itemId || slot === 'Body' || slot === 'Head') continue;
      selectedItems[slot] = {
        name: item.name ?? slot,
        desc: item.desc ?? '',
        id: item.itemId,
        region: 'GMS',
        version: '265',
        typeInfo: {
          overallCategory: item.overallCategory,
          category: item.category,
          subCategory: slot,
          lowItemId: item.lowItemId,
          highItemId: item.highItemId,
        },
        ...(item.isCash !== undefined && { isCash: item.isCash }),
        ...(item.requiredJobs && { requiredJobs: item.requiredJobs }),
      };
    }
    return { ...createOutfit(now), skin: String(skinId), selectedItems };
  } catch {
    return null;
  }
}

/** reads the cast, falling back through the two older single character keys */
function loadChars(now: number): { chars: Outfit[]; activeId: number } {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const saved = JSON.parse(stored) as {
        chars?: Outfit[];
        activeId?: number;
      };
      if (saved.chars?.length) {
        const activeId = saved.chars.some(c => c.id === saved.activeId)
          ? (saved.activeId as number)
          : saved.chars[0].id;
        return { chars: saved.chars, activeId };
      }
    } catch {
      // a corrupt key shouldn't take the page down
    }
  }

  const solo = localStorage.getItem(SOLO_KEY);
  if (solo) {
    try {
      const one = JSON.parse(solo) as Outfit;
      return { chars: [one], activeId: one.id };
    } catch {
      // fall through to a default
    }
  }

  const one = migrateLegacy(now) ?? createOutfit(now);
  return { chars: [one], activeId: one.id };
}

/** ids are timestamps, so a rapid add would collide without this */
const nextId = (chars: Outfit[]) =>
  Math.max(Date.now(), ...chars.map(c => c.id + 1));

export function CharProvider({ children }: { children: React.ReactNode }) {
  const [chars, setChars] = useState<Outfit[]>([FALLBACK]);
  const [activeId, setActiveId] = useState(FALLBACK.id);
  const [captions, setCaptions] = useState<Record<number, Captions>>({});
  const [focusReq, setFocusReq] = useState<{ id: number; n: number } | null>(
    null,
  );
  const [hydrated, setHydrated] = useState(false);

  const focusChar = useCallback((id: number) => {
    setActiveId(id);
    setFocusReq(prev => ({ id, n: (prev?.n ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    const loaded = loadChars(Date.now());
    setChars(loaded.chars);
    setActiveId(loaded.activeId);
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY}-captions`);
      if (raw) setCaptions(JSON.parse(raw));
    } catch {
      // captions are decoration, a bad key just means none
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ chars, activeId }));
  }, [chars, activeId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(`${STORAGE_KEY}-captions`, JSON.stringify(captions));
  }, [captions, hydrated]);

  const outfit = useMemo(
    () => chars.find(c => c.id === activeId) ?? chars[0] ?? FALLBACK,
    [chars, activeId],
  );

  // every existing writer calls setOutfit, it just lands on the active character
  const setOutfit = useCallback<React.Dispatch<React.SetStateAction<Outfit>>>(
    update => {
      setChars(prev =>
        prev.map(c => {
          if (c.id !== activeId) return c;
          const next =
            typeof update === 'function'
              ? (update as (o: Outfit) => Outfit)(c)
              : update;
          // an imported outfit brings its own id, which would orphan the
          // active selection and silently strand the character
          return { ...next, id: c.id };
        }),
      );
    },
    [activeId],
  );

  const addChar = useCallback(() => {
    setChars(prev => {
      if (prev.length >= MAX_CHARS) return prev;
      const born = createOutfit(nextId(prev));
      setActiveId(born.id);
      return [...prev, born];
    });
  }, []);

  const duplicateChar = useCallback((id: number) => {
    setChars(prev => {
      if (prev.length >= MAX_CHARS) return prev;
      const src = prev.find(c => c.id === id);
      if (!src) return prev;
      const copy = { ...src, id: nextId(prev), name: `${src.name} copy` };
      setActiveId(copy.id);
      return [...prev, copy];
    });
  }, []);

  // the file brings an id of its own, and it is the exporter's, so it gets a
  // fresh one here the same way a duplicate does. keeping it would collide with
  // whoever already holds that id and strand one of them
  const importChar = useCallback(
    (imported: Outfit) => {
      if (chars.length >= MAX_CHARS) return false;
      setChars(prev => {
        if (prev.length >= MAX_CHARS) return prev;
        const born = { ...imported, id: nextId(prev) };
        setActiveId(born.id);
        return [...prev, born];
      });
      return true;
    },
    [chars.length],
  );

  const removeChar = useCallback((id: number) => {
    setChars(prev => {
      const left = prev.filter(c => c.id !== id);
      // never an empty stage, the closet would have nothing to point at
      const next = left.length ? left : [createOutfit(nextId(prev))];
      setActiveId(a => (a === id ? next[0].id : a));
      return next;
    });
    setCaptions(prev => {
      const { [id]: _gone, ...rest } = prev;
      return rest;
    });
  }, []);

  const renameChar = useCallback((id: number, name: string) => {
    setChars(prev => prev.map(c => (c.id === id ? { ...c, name } : c)));
  }, []);

  const equip = useCallback(
    (slot: string, item: OutfitItem) => {
      setOutfit(prev => {
        const into = equipInto(prev, slot, item);
        if (!into) return prev;
        return {
          ...prev,
          selectedItems: { ...prev.selectedItems, [into[0]]: into[1] },
        };
      });
    },
    [setOutfit],
  );

  const unequip = useCallback(
    (slot: string) => {
      setOutfit(prev => {
        const { [slot]: _removed, ...rest } = prev.selectedItems;
        return { ...prev, selectedItems: rest };
      });
    },
    [setOutfit],
  );

  // An `undefined` in the patch *removes* the key rather than storing it, so a
  // value reset to neutral leaves no trace in the render URL or the export.
  const adjustItem = useCallback(
    (slot: string, patch: Partial<OutfitItem>) => {
      setOutfit(prev => {
        const item = prev.selectedItems[slot];
        if (!item) return prev;
        const next = { ...item, ...patch };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete next[key as keyof OutfitItem];
        }
        return {
          ...prev,
          selectedItems: { ...prev.selectedItems, [slot]: next },
        };
      });
    },
    [setOutfit],
  );

  const setSkinId = useCallback(
    (id: number) => setOutfit(prev => withSkin(prev, id)),
    [setOutfit],
  );

  const toggleAnimating = useCallback(
    () => setOutfit(prev => ({ ...prev, animating: !prev.animating })),
    [setOutfit],
  );

  const setEmotion = useCallback(
    (emotion: string) => setOutfit(prev => ({ ...prev, emotion })),
    [setOutfit],
  );

  const captionsOf = useCallback(
    (id: number) => captions[id] ?? { speech: NO_CAPTION, nametag: NO_TAG },
    [captions],
  );

  const setCaption = useCallback(
    (id: number, kind: 'speech' | 'nametag', patch: Partial<Caption>) => {
      setCaptions(prev => {
        const cur = prev[id] ?? { speech: NO_CAPTION, nametag: NO_TAG };
        return {
          ...prev,
          [id]: { ...cur, [kind]: { ...cur[kind], ...patch } },
        };
      });
    },
    [],
  );

  const value = useMemo(
    () => ({
      chars,
      activeId,
      setActiveId,
      addChar,
      duplicateChar,
      importChar,
      removeChar,
      renameChar,
      outfit,
      setOutfit,
      equip,
      unequip,
      adjustItem,
      skinId: skinIdOf(outfit),
      setSkinId,
      animating: outfit.animating,
      toggleAnimating,
      emotion: outfit.emotion,
      setEmotion,
      captionsOf,
      setCaption,
      focusChar,
      focusReq,
      hydrated,
    }),
    [
      chars,
      activeId,
      addChar,
      duplicateChar,
      importChar,
      removeChar,
      renameChar,
      outfit,
      setOutfit,
      equip,
      unequip,
      adjustItem,
      setSkinId,
      toggleAnimating,
      setEmotion,
      captionsOf,
      setCaption,
      focusChar,
      focusReq,
      hydrated,
    ],
  );

  return <CharContext.Provider value={value}>{children}</CharContext.Provider>;
}

export default function useChar() {
  return useContext(CharContext);
}
