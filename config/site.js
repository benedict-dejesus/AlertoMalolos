/**
 * Public identity and copy for AlertoMalolos.
 * Wording shown to citizens lives here so it can be reviewed in one place.
 */

export const SITE = {
  name: 'AlertoMalolos',
  tagline: 'Important announcements for the citizens of Malolos.',
  description:
    'AlertoMalolos is a civic announcement board that collects active public advisories affecting the City of Malolos and links each one back to its official source.',
  locale: 'en-PH',
  timeZone: 'Asia/Manila',
  // Set this to the public address before deploying; used for canonical links
  // and social previews.
  origin: 'https://benedict-dejesus.github.io/AlertoMalolos',
  basePath: '/AlertoMalolos',
  updateIntervalMinutes: 60,
};

export const AUTHOR = {
  name: 'Benedict de Jesus',
  role: 'Author and developer',
  short: 'A civic information project by Benedict de Jesus',
  long: 'AlertoMalolos was designed and built by Benedict de Jesus as an independent public-service project for his fellow residents of Malolos.',
};

export const DISCLAIMER = {
  short:
    'Independent civic project. Not the official website of the City Government of Malolos.',
  full: [
    'AlertoMalolos is an independent civic information project. It is not the official website of the City Government of Malolos and is not operated by any government office.',
    'Every announcement on this board comes from an official source, is shown with its publisher and publication time, and links back to the original notice.',
    'The original announcement is always the authority. For anything that affects your safety, confirm the details with the official source before acting.',
  ],
};

export const NAV = [
  { href: 'index.html', label: 'Board' },
  { href: 'about.html', label: 'About' },
  { href: 'sources.html', label: 'Sources' },
];

export const EMPTY_STATE = {
  title: 'No major announcements right now.',
  body: 'AlertoMalolos is monitoring official sources. When an advisory affects Malolos, it is posted here.',
};
