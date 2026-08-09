/**
 * Editorial rules for AlertoMalolos.
 *
 * Everything the pipeline uses to decide "is this a civic announcement a
 * Malolos citizen needs?" lives here. The rules are deliberately conservative:
 * a candidate that does not clearly qualify is rejected. Publishing noise costs
 * more trust than missing an item.
 *
 * Patterns are matched against lowercased, accent-folded text, so write them in
 * lowercase. Both English and Filipino wording are covered.
 */

/**
 * Announcement categories. `weight` is the baseline civic importance (0-100),
 * `ttlHours` is how long an item of this kind stays useful when no explicit
 * end date can be read from the text.
 */
export const CATEGORIES = {
  emergency: {
    id: 'emergency',
    label: 'Emergency',
    description: 'Disaster, evacuation and public safety advisories.',
    weight: 100,
    ttlHours: 48,
    patterns: [
      /\bevacuat(e|ion|ing)\b/, /\bstate of calamity\b/, /\bdisaster\b/,
      /\blifeline\b/, /\bsearch and rescue\b/, /\bemergency (advisory|alert|hotline)\b/,
      /\bpaglikas\b/, /\blindol\b/, /\bearthquake\b/, /\bfire (advisory|alert)\b/,
      /\bsunog\b/, /\btsunami\b/, /\bstorm surge\b/, /\bdaluyong\b/,
    ],
  },
  weather: {
    id: 'weather',
    label: 'Weather',
    description: 'Severe weather bulletins, rainfall and flood advisories.',
    weight: 88,
    ttlHours: 24,
    patterns: [
      /\btropical (cyclone|depression|storm)\b/, /\btyphoon\b/, /\bbagyo\b/,
      /\bsevere weather bulletin\b/, /\bwind signal\b/, /\bsignal no\.? ?\d\b/,
      /\brainfall (advisory|warning)\b/, /\bthunderstorm advisory\b/,
      /\bflood(ing)? (advisory|warning|alert)\b/, /\bbaha\b/, /\bpagbaha\b/,
      /\bgale warning\b/, /\borange rainfall\b/, /\bred rainfall\b/, /\byellow rainfall\b/,
      /\bhabagat\b/, /\bamihan\b/, /\blow pressure area\b/,
    ],
  },
  suspension: {
    id: 'suspension',
    label: 'Class & work suspension',
    description: 'Suspension of classes and government work.',
    weight: 95,
    ttlHours: 30,
    patterns: [
      /\bsuspension of (classes|work|government work)\b/, /\bclass(es)? (are |is )?suspended\b/,
      /\bwork (is |are )?suspended\b/, /\bsuspend(ed|ing)? (classes|work)\b/,
      /\bwalang (pasok|klase)\b/, /\bsuspendido ang (klase|pasok|trabaho)\b/,
      // The noun form is what an official memorandum actually uses:
      // "SUSPENSYON NG KLASE SA LAHAT NG ANTAS ...". Without these a provincial
      // or city suspension memo reads as having no announcement signal at all.
      /\bsuspensyon ng (klase|pasok|trabaho)\b/, /\bpagsuspinde ng (klase|pasok|trabaho)\b/,
      /\bkanselado ang (klase|pasok)\b/,
      /\bno classes\b/, /\bclass suspension\b/, /\bwork suspension\b/,
      /\bskeleton (work)?force\b/, /\bshift to (asynchronous|online) classes\b/,
    ],
  },
  roads: {
    id: 'roads',
    label: 'Roads & traffic',
    description: 'Road closures, rerouting and traffic advisories.',
    weight: 74,
    ttlHours: 24 * 7,
    patterns: [
      /\broad (closure|closed|reblocking|works?)\b/, /\btraffic (advisory|rerouting|scheme)\b/,
      /\brerout(e|ing)\b/, /\blane closure\b/, /\bbridge (closure|closed|repair)\b/,
      /\bsarado ang (kalsada|daan|tulay)\b/, /\bno (parking|entry) (zone|policy)\b/,
      /\bdetour\b/, /\bimpassable\b/, /\bhindi madaanan\b/, /\bnot passable\b/,
    ],
  },
  utilities: {
    id: 'utilities',
    label: 'Water & power',
    description: 'Water and power interruptions and service maintenance.',
    weight: 78,
    ttlHours: 36,
    patterns: [
      /\bwater (interruption|service interruption|outage)\b/, /\bwalang tubig\b/,
      /\bpower (interruption|outage)\b/, /\bbrownout\b/, /\bblackout\b/,
      /\bscheduled maintenance\b/, /\bservice interruption\b/, /\bwalang kuryente\b/,
      /\bboil water\b/, /\bpagkawala ng (tubig|kuryente)\b/, /\bpower restoration\b/,
    ],
  },
  health: {
    id: 'health',
    label: 'Health',
    description: 'Health advisories, outbreaks and vaccination drives.',
    weight: 80,
    ttlHours: 24 * 10,
    patterns: [
      /\bhealth advisory\b/, /\boutbreak\b/, /\bdengue\b/, /\bmeasles\b/, /\bpolio\b/,
      /\bvaccination (drive|schedule|campaign)\b/, /\bbakuna(han)?\b/,
      /\bfree (medical|check-?up|consultation)\b/, /\bepidemic\b/, /\bpandemic\b/,
      /\bleptospirosis\b/, /\bcholera\b/, /\brabies (vaccination|advisory)\b/,
      /\bpublic health (warning|advisory)\b/,
    ],
  },
  services: {
    id: 'services',
    label: 'Government services',
    description: 'Changes to city services, deadlines and public notices.',
    weight: 62,
    ttlHours: 24 * 14,
    patterns: [
      /\bdeadline (for|of|is|extended)\b/, /\bextended until\b/, /\blast day (to|of|for)\b/,
      /\bregistration (period|deadline|is now open)\b/, /\bpayment deadline\b/,
      /\brelocat(ed|ion) of (the )?office\b/, /\btemporar(y|ily) (closed|closure|relocated)\b/,
      /\bpublic (hearing|consultation|notice)\b/, /\bnew (operating|office) hours\b/,
      /\bservice (advisory|suspension)\b/, /\bmoratorium\b/, /\bcurfew\b/,
      /\bliquor ban\b/, /\bgun ban\b/, /\bassistance program\b/, /\bayuda\b/,
      /\bdistribution of (relief|assistance|ayuda)\b/,
    ],
  },
};

/**
 * Order matters: the first match wins. A class suspension caused by a typhoon
 * is filed as a suspension, because that is the part a resident has to act on.
 */
export const CATEGORY_ORDER = ['emergency', 'suspension', 'weather', 'utilities', 'roads', 'health', 'services'];

/**
 * Wording that makes something an announcement rather than a story about one.
 * A candidate needs at least one of these OR a category pattern hit.
 */
export const ANNOUNCEMENT_SIGNALS = [
  /\badvisory\b/, /\bnotice (to|of) (the )?public\b/, /\bpublic (advisory|notice|announcement)\b/,
  /\babiso\b/, /\bpaalala\b/, /\bpaunawa\b/, /\bannouncement\b/, /\bbulletin\b/,
  /\beffective (immediately|today|tomorrow|on)\b/, /\bplease be (advised|informed)\b/,
  /\ball residents\b/, /\bthe public is (advised|urged|reminded)\b/,
  /\bhereby (announces?|informs?|declares?)\b/, /\bmapaalalahanan\b/, /\bipinaaalam\b/,
];

/**
 * Wording typical of news, publicity and commentary. Any hit is a hard reject
 * unless the text also carries an emergency or suspension signal.
 */
export const NEWS_DISQUALIFIERS = [
  /\bphoto release\b/, /\bpress release on\b/, /\bfeature story\b/, /\bin photos\b/,
  /\blook:/, /\bwatch:/, /\bread:/, /\bstory by\b/, /\bphotos? by\b/,
  /\bcongratulat(e|es|ions|ory)\b/, /\bmabuhay\b/, /\bpagbati\b/,
  /\bribbon[- ]cutting\b/, /\bgroundbreaking\b/, /\binauguration\b/, /\bturnover ceremony\b/,
  /\bcourtesy call\b/, /\boath[- ]taking\b/, /\bcommencement (exercise|ceremony)\b/,
  /\bawarded?\b/, /\bawarding\b/, /\brecogni(z|s)ed as\b/, /\bhall of fame\b/,
  /\bwins?\b/, /\bwinner\b/, /\bchampion(ship)?\b/, /\bmedal(l?ist)?\b/,
  /\bpageant\b/, /\bfestival highlights\b/, /\bconcert\b/, /\bshowbiz\b/,
  /\bopinion\b/, /\beditorial\b/, /\bcolumn\b/, /\bcommentary\b/,
  /\bcampaign (rally|sortie)\b/, /\bendorse(d|ment)\b/, /\bcandidate\b/, /\bproclamation rally\b/,
  /\bbirthday\b/, /\banniversary celebration\b/, /\bfeast day\b/, /\bthanksgiving\b/,
  /\barrested\b/, /\bnabbed\b/, /\bslain\b/, /\bshot dead\b/, /\bdrug bust\b/, /\bmanhunt\b/,
  /\bfiled charges\b/, /\bcourt ruling\b/, /\bpress (conference|release) on the success\b/,
  /\bgroundwork for\b/, /\bsigning of the memorandum\b/, /\bmou signing\b/,
  /\bstock (market|price)\b/, /\bbox office\b/, /\bbasketball\b/, /\bvolleyball\b/,
  /\bkudos\b/, /\bsalute\b/, /\bhonored\b/, /\bhonoured\b/,
];

/**
 * Disqualifiers are overridden when the text carries one of these: an official
 * advisory can legitimately mention an award ceremony being cancelled, etc.
 */
export const DISQUALIFIER_OVERRIDES = [
  ...CATEGORIES.emergency.patterns,
  ...CATEGORIES.suspension.patterns,
  /\bcancelled? due to\b/, /\bpostponed due to\b/, /\bsuspended due to\b/,
];

/**
 * Geographic relevance. Higher tiers give a higher relevance score.
 */
export const MALOLOS_TERMS = [
  /\bmalolos\b/, /\bcity of malolos\b/, /\blungsod ng malolos\b/,
];

/** Barangays of the City of Malolos. Editable; used for local relevance. */
export const MALOLOS_BARANGAYS = [
  'anilao', 'atlag', 'babatnin', 'bagna', 'bagong bayan', 'balayong', 'balite',
  'bangkal', 'barihan', 'bulihan', 'bungahan', 'caingin', 'calero', 'caliligawan',
  'canalate', 'caniogan', 'catmon', 'cofradia', 'dakila', 'guinhawa', 'ligas',
  'liyang', 'longos', 'look 1st', 'look 2nd', 'lugam', 'mabolo', 'mambog',
  'masile', 'matimbo', 'mojon', 'namayan', 'niugan', 'pamarawan', 'panasahan',
  'pinagbakahan', 'san agustin', 'san gabriel', 'san juan', 'san pablo',
  'san vicente', 'santiago', 'santisima trinidad', 'santo cristo', 'santo nino',
  'santo rosario', 'sumapang bata', 'sumapang matanda', 'taal', 'tikay',
];

export const BULACAN_TERMS = [
  /\bbulacan\b/, /\bcalumpit\b/, /\bhagonoy\b/, /\bpaombong\b/, /\bplaridel\b/,
  /\bpulilan\b/, /\bbulakan\b/, /\bguiguinto\b/, /\bbalagtas\b/, /\bbocaue\b/,
  /\bmarilao\b/, /\bmeycauayan\b/, /\bsan jose del monte\b/, /\bbaliwag\b/,
  /\bangat\b/, /\bnorzagaray\b/, /\bobando\b/, /\bsanta maria, bulacan\b/,
];

export const REGIONAL_TERMS = [
  /\bcentral luzon\b/, /\bregion (iii|3)\b/, /\bpampanga\b/, /\bnueva ecija\b/,
  /\btarlac\b/, /\bzambales\b/, /\baurora\b/, /\bbataan\b/,
];

export const NATIONAL_TERMS = [
  /\bnationwide\b/, /\bthe (entire )?country\b/, /\bbuong bansa\b/, /\bphilippines\b/,
  /\ball (regions|provinces|local government units)\b/, /\bluzon\b/,
];

export const RELEVANCE_SCORES = {
  malolosNamed: 100,
  barangayNamed: 96,
  bulacanNamed: 74,
  regionalNamed: 52,
  nationalNamed: 40,
  none: 0,
};

/**
 * Publication thresholds. A candidate must clear every one of them.
 * Raising these makes the board quieter; lowering them makes it noisier.
 */
export const THRESHOLDS = {
  minRelevance: 52,
  minImportance: 45,
  minTotal: 55,
  // Nationwide items must be more important than local ones to earn a spot.
  minImportanceForNationalScope: 78,
  // Titles shorter than this are usually navigation junk rather than notices.
  minTitleLength: 12,
  maxTitleLength: 220,
  // Similarity at or above this, within the window, means "same announcement".
  duplicateSimilarity: 0.72,
  duplicateWindowHours: 24 * 5,
};

/** Scoring weights for the final ranking. Must sum to 1. */
export const SCORE_WEIGHTS = {
  importance: 0.35,
  relevance: 0.3,
  urgency: 0.2,
  freshness: 0.15,
};

/** Board size rules. These are hard limits, not suggestions. */
export const BOARD_LIMITS = {
  maxPostIts: 20,
  priorityCount: 3,
  // An item that scores at least this much is never evicted to make room.
  protectedScore: 88,
};

/** How long an item may stay on the board with no end date of its own. */
export const DEFAULT_TTL_HOURS = 24 * 5;

/** Snippet length for the alert face. Snippets are trimmed source text only. */
export const SNIPPET = {
  maxChars: 190,
  minChars: 40,
};

/** Signals that an item affects a large number of people. */
export const SCALE_SIGNALS = [
  /\ball (residents|barangays|schools|offices|households|consumers)\b/,
  /\bcity-?wide\b/, /\bprovince-?wide\b/, /\bentire (city|province|barangay)\b/,
  /\ball (public and private)\b/, /\bpublic and private schools\b/,
  /\ball levels\b/, /\bbuong (lungsod|lalawigan|barangay)\b/,
];

/** Signals that timing matters right now. */
export const URGENCY_SIGNALS = [
  /\beffective immediately\b/, /\bas of (today|now)\b/, /\bongoing\b/, /\bright now\b/,
  /\btoday\b/, /\btomorrow\b/, /\bbukas\b/, /\bngayong araw\b/, /\bmamayang\b/,
  /\bwithin (\d+) hours?\b/, /\buntil further notice\b/, /\bimmediate(ly)?\b/,
  /\bevacuate now\b/, /\bprepare\b/, /\bstay (indoors|home|alert)\b/,
];
