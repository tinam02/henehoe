/**
 * after LATEST-ITEMS.m
 */

export type ChangeEntry = {
  /** yyyy-mm-dd drives <time datetime> and the sitemap lastModified */
  date: string;
  title: string;
  body?: string;
  /** bullets */
  notes?: string[];
};

export const CHANGELOG: ChangeEntry[] = [
  {
    date: '2026-09-12',
    title: 'Frieren',
    body: 'etc',
    notes: [
      '827 new items: 296 hairs, 236 faces, 85 hats, 64 overalls, 49 shoes, 39 weapons, 36 capes, 17 accessories, 7 gloves',
      'Frieren, Fern, Stark, Himmel, Übel, Aura, Linie and Lügner sets',
      'Sol, Red Moon Circus, Night Troupe, Maple Invasion, Pepe and the Jockey sets came with them',
      'rm 146 old items that never drew anything',
    ],
  },
  {
    date: '2026-08-14',
    title: 'Gun hold',
    body: 'Added gun sprites, the stand is available in the pose picker',
  },
  {
    date: '2026-08-12',
    title: 'Maps have their weather back',
    body: "Backdrops run the map's own particle emitters",
    notes: [
      'Maps that hold two versions of themselves now pick 1 instead of drawing both on top of each other',
    ],
  },
  {
    date: '2026-08-10',
    title: 'Every item has a page',
    body: 'The closet is now browsable as a db',
    notes: [
      '26,317 item pages, and a hub for each of the 13 categories',
      'Hairstyles and faces share 1 page with all of their colours',
      'Every page says what the item hides and which slots it takes up',
    ],
  },
  {
    date: '2026-08-10',
    title: 'Henehoe is live',
    body:
      'The closet now runs entirely on art extracted from the game client, so it ' +
      'is no longer capped at whatever the old public API happened to have.',
    notes: [
      '52,724 items across 13 tabs,',
      'Characters are composited in the browser and animated on real frame delays',
      'Poses, expressions, ear types, chat balloons, name tags and map backdrops',
      'Save a character as an animated PNG',
    ],
  },
];

/** newest first, whatever order the array happens to be written in */
export const entries = () =>
  [...CHANGELOG].sort((a, b) => b.date.localeCompare(a.date));

/** for metadata and the sitemap */
export const lastUpdated = () => entries()[0]?.date ?? '2026-08-10';

export const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
