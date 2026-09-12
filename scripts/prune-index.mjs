// drops index entries we cannot actually render
//
//   node scripts/prune-index.mjs           report only
//   node scripts/prune-index.mjs --write   rewrite the index files
//
// extract-index.lua indexes anything with an icon, which is not the same set as
// anything with a wearable sprite. Character/Accessory in particular is 62%
// icon-only records that never appear on a character, and a closet that offers
// them is a closet where clicking an item does nothing.
//
// run after extract-avatar.lua, and again after any extraction that adds art.
//
// always rebuilt from the chunk files extract-index.lua leaves behind, never
// from the last pruned result. that way extracting more sprites and pruning
// again brings items BACK, where editing the index in place only ever removed
// and a mistake meant re-reading the wz to undo it

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'C:/TINA/CODE/bannedstory/bannedstory/.avatar-out';
const INDEX = join(OUT, 'index');
const write = process.argv.includes('--write');

const FOLDERS = [
  'Cap', 'Coat', 'Longcoat', 'Pants', 'Shoes',
  'Glove', 'Cape', 'Weapon', 'Accessory',
];

/**
 * Ids that have art we can actually draw.
 *
 * A file existing is not enough. Some items are effect only: their whole
 * appearance is an animation in Effect.wz/ItemEff.img and what sits in
 * Character.wz is a 1x1 placeholder. 742 of 1660 capes are like that, plus
 * some weapons and hats.
 *
 * Effects render now, so an effect counts as art. Only an item that is 1x1
 * AND has no effect is a tile you can click that does nothing
 */
const effectIds = (() => {
  const f = join(OUT, 'Effect', 'index.json');
  if (!existsSync(f)) return new Set();
  const j = JSON.parse(readFileSync(f, 'utf8'));
  return new Set((j.items ?? j).map(e => Number(e.id ?? e)));
})();

const spriteIds = folder => {
  const dir = join(OUT, folder);
  if (!existsSync(dir)) return new Set();
  const out = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let j;
    try {
      j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    const id = Number(f.replace('.json', ''));
    const canvases = Object.values(j.canvases ?? {});
    const drawable =
      canvases.length > 0 && !canvases.every(c => c.w <= 1 && c.h <= 1);
    if (!drawable && !effectIds.has(id)) continue;
    out.add(id);
  }
  return out;
};

/**
 * The folder's full item list, straight from the chunk files.
 *
 * Deliberately not read from <Folder>.json, which may already be pruned. The
 * chunks are what extract-index.lua wrote and are never edited, so they are the
 * only honest starting point
 */
const fullIndex = folder => {
  const parts = readdirSync(INDEX)
    .filter(f => new RegExp(`^${folder}-part-\\d+\\.json$`).test(f))
    .sort(
      (a, b) =>
        Number(a.match(/-(\d+)\.json$/)[1]) - Number(b.match(/-(\d+)\.json$/)[1]),
    );
  // Cap predates chunking, so it has no parts and its json is all there is.
  // that one can only be pruned, never restored, which is fine: rebuilding it
  // is one ONLY='Cap' run away if it ever matters
  if (!parts.length) {
    const file = join(INDEX, `${folder}.json`);
    if (!existsSync(file)) return null;
    return { ...JSON.parse(readFileSync(file, 'utf8')), fromJson: true };
  }

  const bodies = parts
    .map(p => readFileSync(join(INDEX, p), 'utf8'))
    .filter(Boolean);
  const items = JSON.parse(`[${bodies.join(',')}]`);
  const sheets = parts.map((_, i) => `${folder}-icons-${i}.png`);
  return { sheets, items };
};

let totalKept = 0;
let totalDropped = 0;

console.log('folder      before   after  dropped');
for (const folder of FOLDERS) {
  const file = join(INDEX, `${folder}.json`);
  const idx = fullIndex(folder);
  if (!idx) {
    console.log(`${folder.padEnd(11)} no chunk files, nothing to rebuild from`);
    continue;
  }
  const have = spriteIds(folder);

  // a folder with no sprites at all is not pruned, it is unextracted. dropping
  // every item would look like a clean result and hide the real problem
  if (have.size === 0) {
    console.log(
      `${folder.padEnd(11)}${String(idx.items.length).padStart(7)}` +
        `       -        -   SKIPPED, no sprites extracted yet`,
    );
    continue;
  }

  const before = idx.items.length;
  const kept = idx.items.filter(e => have.has(e.id));
  const dropped = before - kept.length;
  totalKept += kept.length;
  totalDropped += dropped;

  console.log(
    `${folder.padEnd(11)}${String(before).padStart(7)}` +
      `${String(kept.length).padStart(8)}${String(dropped).padStart(9)}` +
      (dropped / before > 0.2 ? '   <-- big drop, worth a look' : ''),
  );

  if (write) {
    // written every time, not just when something was dropped, because this is
    // a rebuild from the chunks and an item whose sprite now exists has to come
    // back into the file
    //
    // the sheets keep their unreferenced icons, which wastes a little space but
    // means no repacking and no chance of shifting a coordinate
    writeFileSync(file, JSON.stringify({ ...idx, items: kept }));
  }
}

console.log('           -------  ------  -------');
console.log(
  `total      ${String(totalKept + totalDropped).padStart(6)}` +
    `${String(totalKept).padStart(8)}${String(totalDropped).padStart(9)}`,
);
console.log(
  write
    ? '\nwritten. re-running extract-index.lua rebuilds the full list, so prune again after'
    : '\nreport only, pass --write to apply',
);
