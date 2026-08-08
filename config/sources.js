/**
 * Trusted source registry for AlertoMalolos.
 *
 * This file is the ONLY place where source credibility is defined. Nothing else
 * in the codebase decides whether a publisher is trustworthy. To add, remove,
 * enable, disable or re-prioritise a source, edit this file only.
 *
 * tier  1 = City Government of Malolos and its offices (highest authority for Malolos)
 * tier  2 = Malolos CDRRMO / barangay governments of Malolos
 * tier  3 = Bulacan provincial government and provincial offices
 * tier  4 = National government agencies (PAGASA, NDRRMC/OCD, DPWH, DOH, DepEd, ...)
 * tier  5 = Official utility and public-service providers serving Malolos
 *
 * A lower tier number wins when the same announcement appears in several places.
 *
 * `scope` tells the relevance scorer how much of the audience is Malolos:
 *   "malolos"  - everything published here is about Malolos
 *   "bulacan"  - provincial; only qualifies when Malolos is materially affected
 *   "regional" - Central Luzon / Region III
 *   "national" - only qualifies for genuinely nationwide civic announcements
 *
 * `kind` selects the reader used to retrieve candidates:
 *   "rss"    - RSS 2.0 or Atom feed
 *   "html"   - HTML listing page, parsed with the `list` selectors below
 *   "graph"  - Facebook Graph API, using a Page access token from the
 *              environment variable named in `tokenEnv`
 *   "manual" - notices recorded by hand in data/curated.json, for official
 *              pages that publish nowhere a machine may read
 *
 * `enabled: false` sources are never contacted and never displayed.
 */

export const SOURCE_TIERS = {
  1: { label: 'City Government of Malolos', authority: 100 },
  2: { label: 'Malolos disaster office & barangays', authority: 92 },
  3: { label: 'Bulacan provincial government', authority: 78 },
  4: { label: 'National government agency', authority: 72 },
  5: { label: 'Official utility / service provider', authority: 66 },
};

/** @type {import('../src/lib/types.js').SourceConfig[]} */
export const SOURCES = [
  // ---------------------------------------------------------------------
  // Tier 1 - City Government of Malolos
  // ---------------------------------------------------------------------
  {
    id: 'malolos-city-website',
    name: 'City Government of Malolos',
    publicDescription: 'Official public announcements from the city government.',
    tier: 1,
    scope: 'malolos',
    kind: 'html',
    homepage: 'https://www.cityofmalolos.gov.ph/',
    url: 'https://www.cityofmalolos.gov.ph/announcements/',
    // The city portal has been intermittently unreachable. It stays in the
    // registry because it is the highest-authority source; the pipeline logs a
    // failure and carries on when it cannot be reached.
    enabled: true,
    list: {
      item: 'article',
      link: 'a',
      title: 'h2, h3, .entry-title',
      date: 'time, .entry-date, .date',
      summary: '.entry-summary, .excerpt, p',
    },
    notes: 'Highest authority for anything affecting Malolos.',
  },

  {
    id: 'malolos-cio-facebook',
    name: 'Malolos City Information Office',
    publicDescription: 'Official announcements from the city information office.',
    tier: 1,
    scope: 'malolos',
    // Facebook prohibits automated collection of its pages without written
    // permission from Meta, so this page is never crawled. Notices are recorded
    // by hand in data/curated.json, each one carrying the link to the original
    // post, and are then judged by exactly the same rules as every other
    // source. See docs/CURATED-SOURCES.md.
    kind: 'manual',
    homepage: 'https://www.facebook.com/MalolosCIOPage',
    url: 'https://www.facebook.com/MalolosCIOPage',
    file: 'data/curated.json',
    // Every recorded notice must link back to this page.
    linkPattern: /^https:\/\/(www\.|m\.|web\.)?facebook\.com\/(MalolosCIOPage|permalink\.php|photo|share\/p|story\.php|profile\.php)/i,
    // Announcements recorded by a person carry a line saying so, so a reader
    // knows to treat the original post as the exact wording.
    transcribed: true,
    allowEmpty: true,
    enabled: true,
  },
  {
    id: 'malolos-cio-graph',
    name: 'Malolos City Information Office',
    publicDescription: 'Official announcements from the city information office.',
    tier: 1,
    scope: 'malolos',
    // The sanctioned automated route: a Page access token issued by the page's
    // own administrators. Switched on only when the token is configured, so the
    // board works without it and improves the moment it exists.
    kind: 'graph',
    homepage: 'https://www.facebook.com/MalolosCIOPage',
    url: 'https://graph.facebook.com/v21.0/MalolosCIOPage/posts',
    tokenEnv: 'MALOLOS_CIO_PAGE_TOKEN',
    linkPattern: /^https:\/\/(www\.|m\.|web\.)?facebook\.com\//i,
    allowEmpty: true,
    enabled: true,
    requiresToken: true,
  },

  // ---------------------------------------------------------------------
  // Tier 3 - Bulacan provincial government
  // ---------------------------------------------------------------------
  {
    id: 'bulacan-province',
    name: 'Provincial Government of Bulacan',
    publicDescription: 'Provincial advisories and public-service announcements.',
    tier: 3,
    scope: 'bulacan',
    kind: 'rss',
    homepage: 'https://bulacan.gov.ph/',
    url: 'https://bulacan.gov.ph/feed/',
    enabled: true,
  },

  // ---------------------------------------------------------------------
  // Tier 4 - National government agencies
  // ---------------------------------------------------------------------
  {
    id: 'pagasa-severe-weather',
    name: 'PAGASA',
    publicDescription: 'Severe weather bulletins and tropical cyclone warnings.',
    tier: 4,
    scope: 'national',
    kind: 'html',
    homepage: 'https://www.pagasa.dost.gov.ph/',
    url: 'https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin',
    enabled: true,
    list: {
      item: '.panel, .card, article, .tc-bulletin',
      link: 'a',
      title: 'h1, h2, h3, .panel-title, .card-title',
      date: 'time, .date, .issued',
      summary: 'p',
    },
    // Between cyclones this page carries no bulletins at all, which is a normal
    // result rather than a retrieval failure.
    allowEmpty: true,
    // Bulletins are national pages; the relevance scorer still requires an
    // explicit Bulacan / Central Luzon / Malolos mention before publishing.
    requiresExplicitLocalMention: true,
  },
  {
    id: 'dpwh-advisories',
    name: 'Department of Public Works and Highways',
    publicDescription: 'Road closures, rerouting and national road works.',
    tier: 4,
    scope: 'national',
    kind: 'rss',
    homepage: 'https://www.dpwh.gov.ph/',
    url: 'https://www.dpwh.gov.ph/dpwh/rss.xml',
    enabled: true,
    requiresExplicitLocalMention: true,
  },
  {
    id: 'deped-central',
    name: 'Department of Education',
    publicDescription: 'Nationwide class suspensions and school advisories.',
    tier: 4,
    scope: 'national',
    kind: 'rss',
    homepage: 'https://www.deped.gov.ph/',
    url: 'https://www.deped.gov.ph/feed/',
    enabled: true,
    requiresExplicitLocalMention: true,
  },
  {
    id: 'deped-region3',
    name: 'DepEd Region III (Central Luzon)',
    publicDescription: 'School advisories for Central Luzon, including Bulacan.',
    tier: 4,
    scope: 'regional',
    kind: 'rss',
    homepage: 'https://region3.deped.gov.ph/',
    url: 'https://region3.deped.gov.ph/feed/',
    enabled: true,
  },
  {
    id: 'official-gazette',
    name: 'Official Gazette of the Philippines',
    publicDescription: 'Proclamations and nationwide work suspensions.',
    tier: 4,
    scope: 'national',
    kind: 'rss',
    homepage: 'https://www.officialgazette.gov.ph/',
    url: 'https://www.officialgazette.gov.ph/feed/',
    enabled: true,
    requiresExplicitLocalMention: true,
  },
  {
    id: 'ndrrmc',
    name: 'National Disaster Risk Reduction and Management Council',
    publicDescription: 'National disaster advisories and situation reports.',
    tier: 4,
    scope: 'national',
    kind: 'rss',
    homepage: 'https://ndrrmc.gov.ph/',
    url: 'https://ndrrmc.gov.ph/feed/',
    // The NDRRMC site currently refuses automated requests. Kept registered and
    // visible on the Sources page, but disabled so no cycle is wasted on it.
    enabled: false,
    disabledReason: 'Site blocks automated retrieval. Re-enable when access is restored.',
    requiresExplicitLocalMention: true,
  },
  {
    id: 'doh',
    name: 'Department of Health',
    publicDescription: 'Health advisories and vaccination announcements.',
    tier: 4,
    scope: 'national',
    kind: 'rss',
    homepage: 'https://doh.gov.ph/',
    url: 'https://doh.gov.ph/feed/',
    enabled: false,
    disabledReason: 'Site blocks automated retrieval. Re-enable when access is restored.',
    requiresExplicitLocalMention: true,
  },
];

/** The access token for a source, or null when none is configured. */
export function sourceToken(source, env = process.env) {
  if (!source?.tokenEnv) return null;
  const value = env[source.tokenEnv];
  return value && value.trim() ? value.trim() : null;
}

/**
 * Sources that will actually be read during an update cycle. A source that
 * needs a token it has not been given is skipped rather than failed: it is a
 * configuration state, not an outage.
 */
export function activeSources(sources = SOURCES, env = process.env) {
  return sources.filter((s) => s.enabled !== false && (!s.requiresToken || sourceToken(s, env)));
}

export function sourceById(id, sources = SOURCES) {
  return sources.find((s) => s.id === id);
}

/**
 * Authority of a source, 0-100. Used to pick the winner among duplicates and
 * to weight the credibility part of the importance score.
 */
export function sourceAuthority(source) {
  if (!source) return 0;
  const tier = SOURCE_TIERS[source.tier];
  return tier ? tier.authority : 0;
}

/** True when the publisher is in the registry and switched on. */
export function isTrustedSource(id, sources = SOURCES) {
  const source = sourceById(id, sources);
  return Boolean(source && source.enabled !== false);
}

/**
 * Citizen-friendly grouping for the public Sources page. One entry per
 * publisher: how a notice is retrieved is not the reader's concern, so the two
 * routes into the city information office appear as one office.
 */
export function sourcesForPublicDisplay(sources = SOURCES) {
  const groups = new Map();
  const seen = new Map();

  for (const source of sources) {
    const label = SOURCE_TIERS[source.tier]?.label ?? 'Other official sources';
    if (!groups.has(label)) groups.set(label, { label, tier: source.tier, sources: [] });

    const key = `${label}::${source.name}`;
    const existing = seen.get(key);
    if (existing) {
      // A publisher counts as active if any route to it is switched on.
      if (source.enabled !== false) existing.enabled = true;
      continue;
    }
    const entry = { ...source };
    seen.set(key, entry);
    groups.get(label).sources.push(entry);
  }
  return [...groups.values()].sort((a, b) => a.tier - b.tier);
}
