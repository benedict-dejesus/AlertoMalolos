# AlertoMalolos

A civic announcement board for the citizens of the City of Malolos, Bulacan.
Designed and built by **Benedict de Jesus**.

AlertoMalolos collects public advisories that are in force right now — class and
work suspensions, road closures, water and power interruptions, flood and severe
weather warnings, health advisories, service changes — from official government
sources, and shows them on one screen with a link back to the original notice.

It is an independent project. It is not the official website of the City
Government of Malolos.

---

## What it is not

It is not a news site. Press releases, ceremonies, awards, campaign material,
opinion, sport and crime reports are rejected by design. When a candidate is
ambiguous, it is dropped. A quiet board is the correct result on a quiet day —
the empty state is a feature, not a failure.

The board never holds more than **20** alerts, and the **three** most
important active notices get the priority treatment.

## How it works

```
check official sources → extract candidates → verify the source and the link →
classify (announcement or news) → score (importance × relevance × urgency ×
freshness) → infer expiry → de-duplicate → merge → expire → rank → cap at 20 →
write state → rebuild the static site → write logs
```

The cycle runs hourly and is idempotent: running it twice in a row changes
nothing but the "last checked" time. Sources are contacted independently, so one
site being down, blocked or redesigned never empties the board.

## Running it

Node 20 or newer. No dependencies to install.

```bash
npm test
```

```bash
npm run update
```

```bash
npm run build
```

```bash
npm run serve
```

Other commands:

| Command | What it does |
| --- | --- |
| `npm run add -- --url … --title … --text …` | Records a notice from an official page that may not be read automatically, and tells you whether the rules accept it |
| `npm run health` | Reports whether each source is actually being retrieved, and exits non-zero when one is broken |
| `npm run health:live` | The same, but contacts every source now — use it after changing a URL |
| `npm run update:dry` | Runs a full cycle against live sources and reports, writing nothing |
| `node src/pipeline/update.js --verbose` | Same as `update`, with every rejection reason printed |
| `npm run preview -- 25` | Builds `.preview/` from sample data (here, 25 candidates to exercise the 20 limit) |
| `npm run preview -- empty` | Builds the empty state |
| `node tools/serve.js .preview 4174` | Serves a preview build |
| `npm run fonts` | Re-downloads the four self-hosted font subsets |
| `node tools/make-social-card.js` | Regenerates the social preview image |

## Layout

```
config/       sources.js  the trusted source registry - the only place
                          credibility is defined
              rules.js    categories, keyword signals, disqualifiers,
                          thresholds, scoring weights, board limits
              site.js     public wording, disclaimer, author credit
src/lib/      retrieval, feed and HTML reading, text, sanitising, time, logging
              health.js   turns the per-source record into a verdict, so a
                          source that never works cannot stay quiet
src/pipeline/ discover → assess (classify, score, expiry) → dedupe → board → store
src/site/     the static renderer, stylesheet, enhancement script and assets
data/         state.json    - the board's internal record (committed)
              curated.json  - notices recorded by hand from pages that may
                              not be read automatically
docs/         DEPLOYMENT.md      - hosting walkthrough, start to finish
              CURATED-SOURCES.md - the Facebook routes and the rules for them
public/       the generated site (committed, served by GitHub Pages)
logs/         per-run logs (not committed)
test/         node:test suites and sample fixtures
```

## Adding or removing a source

Edit `config/sources.js` only. Nothing else in the codebase decides whether a
publisher is credible.

```js
{
  id: 'malolos-cdrrmo',                 // stable, used in record ids
  name: 'Malolos City DRRMO',           // shown on the alert
  publicDescription: 'Disaster advisories and evacuation information.',
  tier: 2,                              // 1 city … 5 utility; lower wins duplicates
  scope: 'malolos',                     // malolos | bulacan | regional | national
  kind: 'rss',                          // 'rss' or 'html'
  homepage: 'https://example.gov.ph/',
  url: 'https://example.gov.ph/feed/',
  enabled: true,
}
```

`kind` picks the reader: `rss`, `html`, `graph` (Facebook Graph API, switched on
only when the token named in `tokenEnv` is set) or `manual` (notices recorded by
hand in `data/curated.json`). Facebook pages are never crawled — see
[docs/CURATED-SOURCES.md](docs/CURATED-SOURCES.md) for why, and for the two
routes that are legitimate.

For an `html` source, add a `list` block with the container, link, title, date
and summary selectors. Add a `linkPattern` when a source shares its domain with
other publishers — it pins announcements to that office's own pages. Set `requiresExplicitLocalMention: true` for national
sources so nothing is posted unless Malolos, a Malolos barangay, Bulacan or
Central Luzon is actually named. Set `allowEmpty: true` for a page that is
legitimately empty most of the time. Set `enabled: false` with a
`disabledReason` to keep a source listed on the public Sources page while it is
not being checked.

## Tuning what gets posted

`config/rules.js` holds the editorial policy:

- `CATEGORIES` — the kinds of notice, their civic weight and how long they stay
  useful without an explicit end date
- `ANNOUNCEMENT_SIGNALS` / `NEWS_DISQUALIFIERS` — the wording that makes
  something an advisory or a story
- `MALOLOS_TERMS`, `MALOLOS_BARANGAYS`, `BULACAN_TERMS` — geographic relevance
- `THRESHOLDS` — raise them for a quieter board, lower them for a busier one
- `SCORE_WEIGHTS`, `BOARD_LIMITS` — ranking and the hard 20 alert cap

Change a threshold, then run `npm run update:dry --verbose` and read the
rejection reasons before committing.

## Content integrity

The snippet on an alert is source text, shortened at sentence boundaries and
marked with an ellipsis where text was removed. Nothing is reworded,
summarised, translated or made more urgent than the original. Dates, times,
place names and numbers are never touched. Every alert links to the original
notice, and the detail view repeats the publisher, the publication time and the
link. Tests in `test/content.test.js` assert that every character of a snippet
appears in the source text.

## Deployment

Full walkthrough: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

In short, `.github/workflows/update-board.yml` runs hourly: tests, then the
update cycle, then it commits `data/` and `public/`, uploads the run log as an
artifact, and deploys `public/` to GitHub Pages. Set `SITE.origin` and
`SITE.basePath` in `config/site.js` to match the address the site is served
from.

The update writes state only after a successful cycle, so a failed run leaves
the previous board in place.

## Keeping the hourly cycle honest

Sources are contacted independently so one site being down never empties the
board. The cost of that resilience is silence: a source can fail every hour for
weeks and the board still looks fine. It happened — the city website was
registered against a domain that does not resolve and had **never once**
succeeded across 17 runs, while the board sat there looking healthy.

So every run now ends with a verdict on each source:

| | |
| --- | --- |
| `healthy` | retrieved on the last run |
| `stale` | failing, but under the limit — a site having a bad hour |
| `broken` | failing for `--max-failures` runs in a row, **or never once retrieved** |

Never-once-retrieved is broken immediately rather than after the limit, because
that is not an outage — it is a wrong URL, and waiting three runs to say so only
delays the fix.

The hourly workflow publishes the board first and reports health afterwards, so
a broken source turns the run red without ever delaying an announcement. The
per-source table appears on the run summary in Actions.

What this does **not** promise: GitHub's scheduled runs are best-effort and can
be late or skipped when Actions is busy, and GitHub disables scheduled workflows
after roughly 60 days without repository activity. The cycle is idempotent, so a
missed hour costs nothing but freshness — but if the board must never miss an
hour, it needs a scheduler that guarantees one.

## Logs

Each run writes `logs/run-<id>.json` — every source contacted and its result,
every candidate discovered, every rejection with its reason, everything added,
updated, expired or taken down, the final board count and the top three — plus a
one-line summary appended to `logs/update.log`. Logs are for maintenance and are
never published.

## Tests

```bash
npm test
```

Covers source credibility and link verification, announcement-versus-news
classification, local relevance including the press-release dateline trap,
snippet fidelity, the board at 1 / 3 / 20 / 21 notices, eviction order,
duplicates across sources, updates, expiry, withdrawal, idempotency, retrieval
failures (timeout, 403, 500, malformed feed, redesigned page, not-modified),
state file corruption, escaping of hostile content, the empty state, and the
accessibility basics of the rendered pages.

It also guards the Facebook policy directly: one test fails the build if any
source is ever configured to crawl a Facebook page, and others cover the curated
intake, link-pattern verification and the Graph API route.

---

**AlertoMalolos** — a civic information project by Benedict de Jesus.
Announcements belong to the offices that issued them; the original announcement
is always the authority.
