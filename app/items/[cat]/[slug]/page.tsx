import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  allItems,
  alsoOccupies,
  categoryByKey,
  categoryPath,
  describe,
  drawsBehind,
  findItem,
  fitScale,
  hairCoverage,
  iconUrl,
  isIndexable,
  itemPath,
  itemsIn,
  metaDescription,
  neighbours,
  ogUrl,
  sameSet,
  titleOf,
} from '@/lib/items';
import Cursor from '@/components/atoms/Cursor';
import { Breadcrumbs, Footer, Grid, SITE, Sprite } from '../../parts';
import styles from '../../items.module.scss';

type Params = { cat: string; slug: string };

// no `dynamicParams = false` here, deliberately.
//
// it reads like the right thing and it is redundant: the site is a static
// export, so a url with no file behind it 404s at caddy and there is no server
// that could have rendered it anyway.
//
// it is also actively broken in next 14. `next dev` derives fallback from it
// (build/utils.js), and with output: export a false fallback fails the check in
// base-server.js, which then throws "missing exported function
// generateStaticParams()" about a function that is right here. production
// builds fine, so this costs you a dev server rather than a deploy
export function generateStaticParams(): Params[] {
  return allItems().map(i => ({ cat: i.c, slug: i.slug }));
}

// findItem is a map built once, not a scan. this runs twice for each of 26,317
// pages and Weapons alone is 7,059 rows, so a scan here is the difference
// between a build that takes minutes and one that takes a lot longer
const find = ({ cat, slug }: Params) => findItem(cat, slug);

export function generateMetadata({ params }: { params: Params }): Metadata {
  const item = find(params);
  if (!item) return {};
  const cat = categoryByKey(item.c);
  const url = itemPath(item);
  const title = `${titleOf(item)}, MapleStory ${cat?.noun ?? 'item'}`;
  const description = metaDescription(item);
  const alt = `${titleOf(item)}, a MapleStory ${cat?.noun ?? 'item'}`;

  // the share card, drawn by tools/ogcards out of the same icon the page shows.
  //
  // only for items that have one. the untranslated 151 are noindex and get no
  // card, and a card that 404s is worse than no card at all: a scraper that
  // fetches one and fails will sometimes drop the preview entirely rather than
  // fall back to the text
  const card = isIndexable(item)
    ? [{ url: ogUrl(item.id), width: 1200, height: 630, alt }]
    : undefined;

  return {
    title,
    description,
    alternates: { canonical: url },
    // the 151 items the client never translated have nothing to rank for, so
    // they stay browsable and stay out of the index
    ...(isIndexable(item) ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      type: 'article',
      url,
      title: `${title} | Henehoe`,
      description,
      siteName: 'Henehoe',
      locale: 'en_GB',
      ...(card ? { images: card } : {}),
    },
    // without this the card renders as a small square thumbnail next to the
    // text. it is the only line that makes twitter and slack use the 1200x630
    ...(card
      ? {
          twitter: {
            card: 'summary_large_image',
            title: `${title} | Henehoe`,
            description,
            images: [ogUrl(item.id)],
          },
        }
      : {}),
  };
}

export default function ItemPage({ params }: { params: Params }) {
  const item = find(params);
  if (!item) notFound();

  const cat = categoryByKey(item.c);
  const { lead, detail } = describe(item);
  const set = sameSet(item);
  const near = neighbours(item);
  const total = itemsIn(item.c).length;
  const also = alsoOccupies(item);
  const hair = hairCoverage(item);
  const scale = fitScale(item.ic[0], item.ic[1], 168);

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Breadcrumbs
          trail={[
            { name: 'Henehoe', href: '/' },
            { name: 'Items', href: '/items' },
            { name: cat?.title ?? item.c, href: categoryPath(item.c) },
            { name: titleOf(item) },
          ]}
        />

        <div className={styles.hero}>
          <div className={styles.heroShot}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.pixels}
              src={iconUrl(item.id)}
              alt={`${titleOf(item)}, a MapleStory ${cat?.noun ?? 'item'}`}
              width={item.ic[0] * scale}
              height={item.ic[1] * scale}
              // the one image above the fold on the page, so it is not lazy
              decoding='async'
            />
          </div>

          <div className={styles.heroBody}>
            <h1 className={styles.title}>{titleOf(item)}</h1>
            <ul className={styles.tags}>
              {item.cash ? (
                <li className={`${styles.tag} ${styles.cash}`}>Cash shop</li>
              ) : (
                <li className={styles.tag}>Regular equip</li>
              )}
              <li className={styles.tag}>{cat?.title ?? item.c}</li>
              {item.fx ? <li className={styles.tag}>Animated effect</li> : null}
            </ul>

            <p className={styles.blurb}>
              {lead} {detail}
            </p>

            {/*
              a plain anchor, not next/link, and the colour swatches below are
              the same.

              WearParam reads window.location, and on a client side navigation
              its effect runs before the router has committed the new url, so
              it would read this page's address and find no `wear` at all. that
              is the same child-effects-run-first ordering that makes it wait
              for CharCtx to hydrate.

              a full load is also just what this link is. it is the boot of the
              whole tool, not a step through the catalogue
            */}
            <a className={styles.wear} href={`/?wear=${item.id}`}>
              Try it on &rarr;
            </a>

            <dl className={styles.facts}>
              <div>
                <dt>Item ID</dt>
                <dd>{item.id}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>
                  <Link href={categoryPath(item.c)}>{cat?.title}</Link>
                </dd>
              </div>
              <div>
                <dt>Obtained from</dt>
                <dd>{item.cash ? 'Cash shop' : 'In game equipment'}</dd>
              </div>
              {item.v && item.v.length > 1 ? (
                <div>
                  <dt>Colours</dt>
                  <dd>{item.v.length}</dd>
                </div>
              ) : null}
              {hair ? (
                <div>
                  <dt>Hair</dt>
                  <dd>
                    {hair === 'all'
                      ? 'Hides the hairstyle completely'
                      : 'Covers part of the hairstyle'}
                  </dd>
                </div>
              ) : null}
              {also.length ? (
                <div>
                  <dt>Also occupies</dt>
                  <dd>{also.join(', ')}</dd>
                </div>
              ) : null}
              {item.pieces ? (
                <div>
                  <dt>Sprite pieces</dt>
                  <dd>
                    {item.pieces}
                    {drawsBehind(item) ? ', some drawn behind the character' : ''}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>

        {item.v && item.v.length > 1 ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              {titleOf(item)} colours
            </h2>
            <p className={styles.sectionNote}>
              Every colour is the same {cat?.noun}, so they share this page.
              Each one has its own item ID in game.
            </p>
            <ul className={styles.colours}>
              {item.v.map(v => {
                const s = fitScale(v.ic[0], v.ic[1], 44);
                return (
                  <li key={v.id}>
                    <a
                      className={styles.swatch}
                      id={String(v.id)}
                      href={`/?wear=${v.id}`}
                    >
                      <span className={styles.swatchShot}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className={styles.pixels}
                          src={iconUrl(v.id)}
                          alt={`${titleOf(item)}${v.name ? `, ${v.name}` : ''}`}
                          width={v.ic[0] * s}
                          height={v.ic[1] * s}
                          loading='lazy'
                          decoding='async'
                        />
                      </span>
                      <span className={styles.swatchName}>
                        {v.name ?? v.id}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {set.length ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Goes with</h2>
            <p className={styles.sectionNote}>
              Items with similar name
            </p>
            <Grid items={set} />
          </section>
        ) : null}

        {near.length ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>More {cat?.title.toLowerCase()}</h2>
            <Grid items={near} />
            <p className={styles.sectionNote} style={{ marginTop: 16 }}>
              <Link href={categoryPath(item.c)}>
                Browse all {total.toLocaleString()} {cat?.title.toLowerCase()}
              </Link>
            </p>
          </section>
        ) : null}

        <Footer />
      </div>
      <Cursor />
    </main>
  );
}
