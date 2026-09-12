// builds and ships the site to the vps
//
//   node scripts/deploy.mjs --dry     say what it would do
//   node scripts/deploy.mjs           site only, quick
//   node scripts/deploy.mjs --assets  site and any assets the box is missing
//   node scripts/deploy.mjs --clean   wipe the web root first, see below
//   node scripts/deploy.mjs --no-build  ship the export already on disk
//
// needs these in .env.local:
//   DEPLOY_HOST=root@1.2.3.4
//   DEPLOY_PATH=/var/www/henehoe
//
// tar, not one file at a time. there are 105k assets and scp opens a fresh
// connection per file, so sending them individually takes hours where one
// archive takes minutes.
//
// assets are compared against what the box already holds, so after the first
// deploy only newly extracted items go. an item's art never changes under the
// same id, which is what makes a name comparison enough

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, statSync, writeFileSync, unlinkSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const OUT = join(ROOT, '.avatar-out');
// its own dist dir, so a deploy never knocks down a running dev server
const DIST_NAME = '.next-deploy';
const DIST = join(ROOT, DIST_NAME);
const PUBLIC_LINK = join(ROOT, 'public', 'avatar');

const DRY = process.argv.includes('--dry');
const WITH_ASSETS = process.argv.includes('--assets');
const CLEAN = process.argv.includes('--clean');
// ship the export that is already sitting in .next-deploy.
//
// for when a deploy died after the build, which is a 26,776 page rebuild you
// do not want to sit through twice. it trusts what is on disk, so it prints
// the export's date and it is on you to know that is the one you meant
const NO_BUILD = process.argv.includes('--no-build');

// what --clean leaves alone. assets travel separately and are 2.6 GB, so they
// are never part of the tar that would put them back
const KEEP = ['avatar'];

const env = (() => {
  const out = { ...process.env };
  const file = join(ROOT, '.env.local');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
})();

const HOST = env.DEPLOY_HOST;
const PATH_ON_BOX = env.DEPLOY_PATH || '/var/www/henehoe';
if (!HOST && !DRY) {
  console.error('missing DEPLOY_HOST in .env.local, eg root@1.2.3.4');
  process.exit(1);
}

const say = (...a) => console.log(...a);
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });

// next is invoked through node directly rather than npx.
//
// npx on windows is npx.cmd, and node 22 refuses to spawn a .cmd without a
// shell on purpose, so it throws EINVAL. calling the js entry point with the
// node we are already running sidesteps shims and shells entirely
const NEXT_BIN = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

// ---------------------------------------------------------------- build

// the junction has to go before building.
//
// `output: 'export'` copies all of public/, and public/avatar points at 53k
// extracted files, so leaving it in place makes a 2 GB site archive full of
// png we do not even serve. the assets travel separately and filtered
const unlinkJunction = () => {
  if (!existsSync(PUBLIC_LINK)) return false;
  say('  moving public/avatar aside for the build');
  if (!DRY) rmSync(PUBLIC_LINK, { recursive: false, force: true });
  return true;
};

const relinkJunction = had => {
  if (!had || DRY) return;
  say('  restoring public/avatar');
  execSync(
    `cmd /c mklink /J "${PUBLIC_LINK}" "${OUT}"`,
    { stdio: 'ignore' },
  );
};

// the catalogue digest, rebuilt every deploy.
//
// it is 9 seconds and it is what every /items page is generated from, so
// running it here rather than trusting a note means a forgotten step can never
// quietly ship a site with 26k pages missing.
//
// --no-icons, because cutting the icons needs the sheets and converting them
// needs ffmpeg. that is part of pulling in an update, not part of shipping
const digest = () => {
  say('building the item digest...');
  if (DRY) return;
  run(process.execPath, [join(ROOT, 'scripts', 'build-item-pages.mjs'), '--no-icons']);

  // an item page points at /avatar/items/<id>.webp. if the cut icons were
  // never converted the pages ship with every picture broken, and the only
  // sign would be the art missing on a page nobody has opened yet
  const pending = existsSync(join(OUT, 'items'))
    ? readdirSync(join(OUT, 'items')).filter(f => f.endsWith('.png')).length
    : 0;
  if (pending) {
    console.error(
      `\n${pending.toLocaleString()} item icons are still png, so their pages would ship broken.\n` +
        'run: node scripts/webp-avatar.mjs --only items --prune\n',
    );
    process.exit(1);
  }
};

const build = () => {
  say('building...');
  if (DRY) return;
  run(process.execPath, [NEXT_BIN, 'build'], {
    env: { ...process.env, NEXT_DIST_DIR: DIST_NAME },
  });
};

// ---------------------------------------------------------------- site diff

/**
 * What the box already holds of the site, by content.
 *
 * The assets below are compared by name, which is sound because an item's art
 * never changes under a given id. The site is the opposite: 26,776 pages that
 * all keep their names forever and whose contents do change, so the only
 * question worth asking is whether the bytes match.
 *
 * `avatar` is pruned rather than hashed. It is 162,065 files and 1.17 GB, it
 * is not part of the site tar, and md5ing it would be the slowest thing in the
 * deploy by a wide margin
 */
const remoteSite = () => {
  //  if (DRY) return new Map();
  // listing runs on a dry run too
  try {
    const listing = execFileSync(
      'ssh',
      [
        HOST,
        `cd ${PATH_ON_BOX} 2>/dev/null && find . -path ./avatar -prune -o -type f -print0 | xargs -0 -r md5sum || true`,
      ],
      { encoding: 'utf8', maxBuffer: 1 << 28 },
    );
    const out = new Map();
    for (const line of listing.split('\n')) {
      // "<32 hex>  ./path/to/file"
      const m = line.match(/^([0-9a-f]{32})\s+\.\/(.+)$/);
      if (m) out.set(m[2], m[1]);
    }
    return out;
  } catch {
    // no listing means send everything, which is what it used to do anyway
    return new Map();
  }
};

const md5 = file => createHash('md5').update(readFileSync(file)).digest('hex');

/**
 * The site files whose bytes are not already on the box.
 *
 * Next writes content-hashed chunk names, so a build with no source change
 * emits byte identical html and every page is skipped. That is the normal
 * weekly case: new items change the pages of those items, the hubs whose
 * paging shifted, the category counts, and the sitemaps. Touch a shared
 * component and every page's chunk reference moves, so everything goes, which
 * is correct and is also exactly what happens today
 */
const changedSite = (files, have) => {
  if (!have.size) return { send: files, same: 0, stale: [] };
  const send = [];
  let same = 0;
  const seen = new Set();
  for (const f of files) {
    const rel = relative(DIST, f).replace(/\\/g, '/');
    seen.add(rel);
    // hash only what the box could plausibly already have. a file it has never
    // heard of is going regardless of its bytes, and hashing it first is 1.3 GB
    // of reads to learn nothing.
    //
    // this is the whole first deploy of the catalogue: 55,000 files the box has
    // none of, every one of them read in full to prove it
    const known = have.get(rel);
    if (known && known === md5(f)) same += 1;
    else send.push(f);
  }
  // on the box but not in this build. hashed chunks from older builds mostly,
  // which are harmless but never go away on their own
  const stale = [...have.keys()].filter(k => !seen.has(k));
  return { send, same, stale };
};

// ---------------------------------------------------------------- assets

const assetFiles = () => {
  const keep = new Set(['.webp', '.json']);
  const skip = new Set(['extract-log.txt', 'index-log.txt', 'found.txt']);

  // og/ is the one place a .png ships from.
  //
  // the share cards are drawn by tools/ogcards, and go's x/image can read webp
  // but not write it. every scraper takes png and an indexed card is about
  // 3 kB, so there is nothing to gain by converting them.
  //
  // note they travel as art below, which is compared by name. that is right
  // for a card whose art never changes under the same id, and wrong the day
  // you redesign the card: the box keeps the ones it already has. wipe
  // <DEPLOY_PATH>/avatar/og first when the design moves
  const wanted = p => {
    const ext = extname(p);
    if (ext === '.png') return relOf(p).startsWith('og/');
    return keep.has(ext);
  };

  const walk = dir => {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (wanted(p) && !skip.has(e.name)) out.push(p);
    }
    return out;
  };
  return walk(OUT);
};

const relOf = f => relative(OUT, f).replace(/\\/g, '/');

// what gets rewritten under the same name every time items are extracted.
//
// the box comparison below is by name, and that is only sound for art: an
// item's sheet never changes under the same id. these do, so comparing names
// would mean the box kept the first index it ever received and no item added
// after the first deploy ever showed up in the closet
const MUTABLE = /^(index\/|meta\.json$|delays\.json$|face-delays\.json$)/;

/**
 * What the box already has, so a patch only sends the new items.
 *
 * Listed on a dry run too. It used to bail out early, which meant --dry always
 * printed "box already holds 0 assets" and the full 1.1 GB
 */
const remoteAssets = () => {
  //  if (DRY) return new Set();
  try {
    const listing = execFileSync(
      'ssh',
      [HOST, `cd ${PATH_ON_BOX}/avatar 2>/dev/null && find . -type f | sed 's|^\\./||' || true`],
      { encoding: 'utf8', maxBuffer: 1 << 28 },
    );
    return new Set(listing.split('\n').map(s => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
};

const sendTar = (files, base, dest, label) => {
  if (!files.length) {
    say(`  ${label}: nothing to send`);
    return;
  }
  const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
  say(`  ${label}: ${files.length.toLocaleString()} files, ${(bytes / 1024 / 1024).toFixed(0)} MB`);
  if (DRY) return;

  const listFile = join(tmpdir(), `henehoe-${label}-${Date.now()}.txt`);
  const archive = join(tmpdir(), `henehoe-${label}-${Date.now()}.tar.gz`);
  writeFileSync(
    listFile,
    files.map(f => relative(base, f).replace(/\\/g, '/')).join('\n'),
  );

  say('   packing...');
  run('tar', ['-czf', archive, '-C', base, '-T', listFile]);

  say('   sending...');
  run('scp', ['-q', archive, `${HOST}:/tmp/henehoe.tar.gz`]);

  say('   unpacking...');
  run('ssh', [
    HOST,
    `mkdir -p ${dest} && tar -xzf /tmp/henehoe.tar.gz -C ${dest} && rm /tmp/henehoe.tar.gz`,
  ]);

  unlinkSync(listFile);
  unlinkSync(archive);
};

// ---------------------------------------------------------------- clean

// unpacking a tar overwrites what it contains and leaves everything else
// alone, so a file deleted here keeps being served off the box forever. the
// hashed chunks under _next/static rename on every build, and anything dropped
// out of public/ just stays. --clean empties the web root so the box matches.
//
// everything under DEPLOY_PATH comes out of the export except avatar, so that
// is the one name held back. the site 404s for the second or two between the
// wipe and the unpack, which is why this is opt in rather than the default
const cleanRemote = () => {
  // a wrong DEPLOY_PATH here is rm -rf on something that is not the web root.
  // absolute, no shell metacharacters, and at least two segments deep, so a
  // stray / or /var can never be the target
  const sane =
    /^\/[\w.-]+(\/[\w.-]+)+\/?$/.test(PATH_ON_BOX) &&
    !PATH_ON_BOX.includes('..');
  if (!sane) {
    console.error(`refusing to clean, DEPLOY_PATH looks wrong: ${PATH_ON_BOX}`);
    process.exit(1);
  }

  // cd fails on a first ever deploy, and && makes that the whole command, so
  // there is nothing to remove and nothing to complain about
  const keepExpr = KEEP.map(n => `! -name '${n}'`).join(' ');
  const find = `cd ${PATH_ON_BOX} 2>/dev/null && find . -mindepth 1 -maxdepth 1 ${keepExpr}`;

  if (DRY) {
    if (!HOST) {
      say(`  clean: would empty ${PATH_ON_BOX}, keeping ${KEEP.join(', ')}`);
      return;
    }
    const listing = execFileSync('ssh', [HOST, `${find} || true`], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    })
      .split('\n')
      .map(s => s.replace(/^\.\//, '').trim())
      .filter(Boolean);
    say(`  clean: would remove ${listing.length} entries from ${PATH_ON_BOX}`);
    for (const e of listing) say(`     ${e}`);
    say(`   keeping ${KEEP.join(', ')}`);
    return;
  }

  say(`  cleaning ${PATH_ON_BOX}, keeping ${KEEP.join(', ')}`);
  run('ssh', [HOST, `${find} -exec rm -rf {} + || true`]);
};

// ---------------------------------------------------------------- go

const main = () => {
  if (NO_BUILD) {
    if (!existsSync(DIST)) {
      console.error(`--no-build, but there is no ${DIST_NAME} to ship`);
      process.exit(1);
    }
    say(`skipping the build, shipping ${DIST_NAME} as built ${statSync(DIST).mtime.toISOString().replace('T', ' ').slice(0, 16)}`);
  } else {
    // before the junction goes, though it reads .avatar-out either way
    digest();

    const had = unlinkJunction();
    try {
      build();
    } finally {
      relinkJunction(had);
    }
  }

  // the export lands in distDir, html and js and everything under public/
  //
  // a dry run does not build, so on a clean checkout there is nothing to list
  // yet. that is expected rather than an error
  const site = existsSync(DIST)
    ? (function walk(dir) {
        const out = [];
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          // build metadata the browser never asks for
          if (e.isDirectory() && ['cache', 'server', 'types'].includes(e.name)) {
            continue;
          }
          if (e.isDirectory()) out.push(...walk(p));
          else if (!e.name.endsWith('.map')) out.push(p);
        }
        return out;
      })(DIST)
    : [];

  // a dry run does not build, so what it just listed is whatever the last rea deploy left behind.
  if (DRY && site.length) {
    say(`  site: listing the last build, ${DIST_NAME} is from ${statSync(DIST).mtime.toISOString().slice(0, 10)}. a dry run does not rebuild`);
  }

  // nothing to put back means nothing should come down. build() throws on a
  // bad build so a real run cannot get here empty, but the wipe is worth the
  // cheap insurance
  if (!DRY && !site.length) {
    console.error(`no files in ${DIST_NAME}, refusing to deploy`);
    process.exit(1);
  }

  // after the build, so a build that throws never leaves the box emptied with
  // nothing to unpack into it
  if (CLEAN) cleanRemote();

  if (!site.length && DRY) {
    say('  site: nothing built yet, a real run builds it first');
  } else if (CLEAN) {
    // the web root was just emptied, so nothing is on the box to compare with
    sendTar(site, DIST, PATH_ON_BOX, 'site');
  } else {
    const { send, same, stale } = changedSite(site, remoteSite());
    if (same) {
      say(`  site: ${same.toLocaleString()} of ${site.length.toLocaleString()} files already on the box, unchanged`);
    }
    if (stale.length) {
      // not deleted here. removing files from the web root is what --clean is
      // for, and doing it silently on every deploy is how you find out your
      // path filter had a bug
      say(`  site: ${stale.length.toLocaleString()} files on the box are not in this build, --clean removes them`);
    }
    sendTar(send, DIST, PATH_ON_BOX, 'site');
  }

  if (WITH_ASSETS) {
    const have = remoteAssets();
    say(`  box already holds ${have.size.toLocaleString()} assets`);
    const all = assetFiles();

    // two tars, art first, and the order is the point. the index is the list
    // of what exists, so shipping it ahead of the sheets it names opens a
    // window where the closet offers items that 404
    const art = all.filter(f => !MUTABLE.test(relOf(f)) && !have.has(relOf(f)));
    const index = all.filter(f => MUTABLE.test(relOf(f)));

    sendTar(art, OUT, `${PATH_ON_BOX}/avatar`, 'art');
    sendTar(index, OUT, `${PATH_ON_BOX}/avatar`, 'index');
  } else {
    say('  assets skipped, pass --assets to send them');
  }

  say(DRY ? '\ndry run, nothing sent' : '\ndone');
};

main();
