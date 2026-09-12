// converts the extracted avatar art to webp, via ffmpeg
//
//   node scripts/webp-avatar.mjs --only index    the closet icon atlases
//   node scripts/webp-avatar.mjs                 everything, ~53k files
//   node scripts/webp-avatar.mjs --prune         delete the png after converting
//
// all lossless. these are pixel sprites with hard alpha edges, and a lossy pass
// puts a halo on every one of them.
//
// nothing is deleted without --prune, and --prune only removes a png whose webp
// decoded back to the identical pixels

import { execFile } from 'node:child_process';
import { readdir, stat, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, extname } from 'node:path';
import { promisify } from 'node:util';
import { decodePNG } from './lib/png.mjs';

const run = promisify(execFile);
const OUT = join(process.cwd(), '.avatar-out');
const PRUNE = process.argv.includes('--prune');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i === -1 ? null : process.argv[i + 1];
})();

// one ffmpeg per core, minus a couple so the machine stays usable
const WORKERS = Math.max(2, cpus().length - 2);

// how many conversions to check pixel for pixel. lossless is lossless, so this
// is here to catch ffmpeg silently doing something else, not to check the maths
const VERIFY = 150;

const size = async p => await stat(p).then(s => s.size, () => 0);

// a webp existing is not a webp being current. build-sprite-icons.mjs rewrites
// the hair and face atlases in place, and a stale webp beside a rebuilt png
// means every icon coordinate in the json points at the wrong pixels
const mtime = async p => await stat(p).then(s => s.mtimeMs, () => 0);
const stale = async (png, webp) =>
  (await mtime(webp)) < (await mtime(png));

const convert = (src, out) =>
  run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', src,
    '-c:v', 'libwebp',
    '-lossless', '1',
    '-q:v', '100',
    out,
  ]);

/**
 * Do the two decode to the same picture, so --prune can never drop a good png
 * for a bad webp.
 *
 * Not a byte compare. Lossless webp is free to rewrite the rgb of a fully
 * transparent pixel, and it does: on one hair atlas 1.4 million pixels differ
 * that way and not one of them is visible. So alpha has to match everywhere,
 * and colour only has to match where something is actually drawn
 */
const samePicture = async (png, webp) => {
  try {
    const a = decodePNG(readFileSync(png)).data;
    const { stdout: b } = await run(
      'ffmpeg',
      ['-loglevel', 'error', '-i', webp, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
      { encoding: 'buffer', maxBuffer: 1 << 28 },
    );
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] !== b[i + 3]) return false;
      if (a[i + 3] === 0) continue;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};

const collect = async dir => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // og/ ships as png on purpose, see assetFiles() in deploy.mjs. converting
      // it just doubles what the box holds
      if (entry.name === 'og') continue;
      if (ONLY && entry.name !== ONLY) continue;
      out.push(...(await collect(p)));
    } else if (extname(entry.name) === '.png') {
      out.push(p);
    }
  }
  return out;
};

const main = async () => {
  // --only index means the atlases, which live in .avatar-out/index
  const root = ONLY === 'index' ? join(OUT, 'index') : OUT;
  const all = ONLY === 'index'
    ? (await readdir(root)).filter(f => f.endsWith('.png')).map(f => join(root, f))
    : await collect(root);

  console.log(`${all.length} png to convert, ${WORKERS} at a time`);

  let done = 0;
  let pngBytes = 0;
  let webpBytes = 0;
  let failed = 0;
  const verifyEvery = Math.max(1, Math.floor(all.length / VERIFY));
  let checked = 0;
  let mismatched = 0;

  const queue = [...all];
  const worker = async () => {
    for (;;) {
      const src = queue.pop();
      if (!src) return;
      const out = src.replace(/\.png$/, '.webp');

      try {
        if (await stale(src, out)) await convert(src, out);
        const [a, b] = [await size(src), await size(out)];
        if (!b) throw new Error('no output');
        pngBytes += a;
        webpBytes += b;

        // spot check, and always check before deleting anything
        const check = PRUNE || done % verifyEvery === 0;
        if (check) {
          checked++;
          const same = await samePicture(src, out);
          if (!same) {
            mismatched++;
            console.log(`  MISMATCH ${src}`);
          } else if (PRUNE) {
            await unlink(src);
          }
        }
      } catch (err) {
        failed++;
        if (failed <= 10) console.log(`  FAILED ${src}: ${err.message}`);
      }

      done++;
      if (done % 500 === 0) {
        process.stdout.write(`  ${done}/${all.length}\r`);
      }
    }
  };

  await Promise.all(Array.from({ length: WORKERS }, worker));

  const mb = n => (n / 1024 / 1024).toFixed(1);
  console.log(`  done ${done}/${all.length}                    `);
  console.log(`  png  ${mb(pngBytes)} MB`);
  console.log(`  webp ${mb(webpBytes)} MB`);
  console.log(
    `  saved ${mb(pngBytes - webpBytes)} MB (${(
      100 - (webpBytes / pngBytes) * 100
    ).toFixed(1)}%)`,
  );
  console.log(`  verified ${checked} pixel for pixel, ${mismatched} mismatched`);
  if (failed) console.log(`  ${failed} failed`);
  if (!PRUNE) console.log('\n  png kept. pass --prune to delete the verified ones');
};

main();
