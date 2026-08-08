/**
 * Sample candidates for tests and for the local preview build.
 *
 * These are NOT real announcements. They are written in the style of the
 * notices the board handles so the rules can be exercised, and they are never
 * used by the live update cycle - only by `npm test` and `tools/preview.js`,
 * which stamps a preview banner on every page it renders.
 */

const HOUR = 60 * 60 * 1000;

export function isoAgo(hours, from = Date.parse('2026-08-08T09:00:00+08:00')) {
  return new Date(from - hours * HOUR).toISOString();
}

/** A well-formed candidate; override any field. */
export function candidate(overrides = {}) {
  return {
    sourceId: 'malolos-city-website',
    title: 'Advisory: water service interruption in Barangay Mojon',
    announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/water-interruption-mojon',
    summary:
      'Please be advised that there will be a water service interruption in Barangay Mojon, City of Malolos on August 9, 2026 from 9:00 AM to 5:00 PM due to scheduled maintenance of the main line. All residents are advised to store water.',
    body: '',
    publishedAt: isoAgo(3),
    guid: 'https://www.cityofmalolos.gov.ph/announcements/water-interruption-mojon',
    categories: [],
    ...overrides,
  };
}

/** Announcements that should be accepted. */
export const QUALIFYING = [
  candidate({
    sourceId: 'malolos-city-website',
    title: 'Suspension of classes in all levels in the City of Malolos on August 9, 2026',
    announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/class-suspension-august-9',
    summary:
      'Classes in all public and private schools in the City of Malolos are suspended tomorrow, August 9, 2026, due to continuous heavy rainfall. All residents are advised to stay indoors and monitor official advisories.',
    publishedAt: isoAgo(2),
    guid: 'malolos-class-suspension-aug-9',
  }),
  candidate({
    sourceId: 'malolos-city-website',
    title: 'Flood advisory for low-lying barangays along the Calumpang River',
    announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/flood-advisory-calumpang',
    summary:
      'A flood advisory is in effect for low-lying barangays of the City of Malolos along the Calumpang River. Residents in Barangay Pamarawan and Barangay Namayan are advised to prepare for possible evacuation. Evacuation centers are open.',
    publishedAt: isoAgo(5),
    guid: 'malolos-flood-advisory-calumpang',
  }),
  candidate({
    sourceId: 'malolos-city-website',
    title: 'Water service interruption in Barangay Mojon and Barangay Tikay',
    announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/water-interruption-mojon-tikay',
    summary:
      'Please be advised that there will be a water service interruption in Barangay Mojon and Barangay Tikay, City of Malolos on August 9, 2026 from 9:00 AM to 5:00 PM due to scheduled maintenance. All residents are advised to store enough water.',
    publishedAt: isoAgo(8),
    guid: 'malolos-water-mojon-tikay',
  }),
  candidate({
    sourceId: 'malolos-city-website',
    title: 'Road closure along Paseo del Congreso until further notice',
    announcementUrl: 'https://www.cityofmalolos.gov.ph/announcements/road-closure-paseo',
    summary:
      'A road closure is in effect along a section of Paseo del Congreso in the City of Malolos due to ongoing drainage works. Motorists are advised of the rerouting scheme in place until further notice.',
    publishedAt: isoAgo(30),
    guid: 'malolos-road-closure-paseo',
  }),
  candidate({
    sourceId: 'bulacan-province',
    title: 'Power interruption advisory for parts of Malolos and Calumpit',
    announcementUrl: 'https://bulacan.gov.ph/power-interruption-malolos-calumpit',
    summary:
      'A scheduled power interruption will affect parts of Malolos and Calumpit, Bulacan on August 10, 2026 from 8:00 AM to 4:00 PM for the replacement of distribution facilities. Consumers are advised to prepare accordingly.',
    publishedAt: isoAgo(14),
    guid: 'bulacan-power-interruption',
  }),
  candidate({
    sourceId: 'bulacan-province',
    title: 'Public advisory on free anti-rabies vaccination in Bulacan',
    announcementUrl: 'https://bulacan.gov.ph/anti-rabies-vaccination-schedule',
    summary:
      'The Provincial Veterinary Office announces a free anti-rabies vaccination drive across Bulacan, including the City of Malolos, from August 12 to August 16, 2026. Pet owners are advised to bring their pets to the designated barangay halls.',
    publishedAt: isoAgo(26),
    guid: 'bulacan-rabies-vaccination',
  }),
  candidate({
    sourceId: 'deped-region3',
    title: 'Advisory on the suspension of classes in Central Luzon due to Tropical Depression',
    announcementUrl: 'https://region3.deped.gov.ph/2026/08/07/class-suspension-advisory',
    summary:
      'Classes in all public schools in Central Luzon, including the Schools Division of the City of Malolos, are suspended today due to the effects of the tropical depression. School heads are advised to secure school facilities.',
    publishedAt: isoAgo(6),
    guid: 'deped-r3-class-suspension',
  }),
  candidate({
    sourceId: 'dpwh-advisories',
    title: 'Traffic advisory: lane closure along MacArthur Highway in Malolos',
    announcementUrl: 'https://www.dpwh.gov.ph/dpwh/node/40001',
    summary:
      'A lane closure will be implemented along MacArthur Highway in the City of Malolos, Bulacan from August 9 to August 11, 2026 for road reblocking. Motorists are advised to use alternate routes.',
    publishedAt: isoAgo(40),
    guid: 'dpwh-macarthur-lane-closure',
  }),
];

/** Candidates that must be rejected, with the reason each one tests. */
export const NON_QUALIFYING = [
  {
    reason: 'ordinary news',
    candidate: candidate({
      sourceId: 'bulacan-province',
      title: 'Bulacan honors top nutrition champions at nutrition month finale',
      announcementUrl: 'https://bulacan.gov.ph/nutrition-month-finale',
      summary:
        'The Provincial Government of Bulacan awarded outstanding municipalities during the nutrition month finale held in the City of Malolos.',
      guid: 'bulacan-nutrition-finale',
    }),
  },
  {
    reason: 'congratulatory post',
    candidate: candidate({
      sourceId: 'malolos-city-website',
      title: 'Congratulations to the newly appointed city officials of Malolos',
      announcementUrl: 'https://www.cityofmalolos.gov.ph/news/congratulations-officials',
      summary: 'The City Government of Malolos congratulates the newly appointed officials who took their oath today.',
      guid: 'malolos-congratulations',
    }),
  },
  {
    reason: 'dateline only, no local effect',
    candidate: candidate({
      sourceId: 'bulacan-province',
      title: 'Provincial board approves the annual investment programme for the province',
      announcementUrl: 'https://bulacan.gov.ph/investment-programme',
      summary:
        'CITY OF MALOLOS - The Sangguniang Panlalawigan approved the annual investment programme during its regular session.',
      guid: 'bulacan-investment-programme',
    }),
  },
  {
    reason: 'no local relevance',
    candidate: candidate({
      sourceId: 'dpwh-advisories',
      title: 'Road closure advisory for the Cebu south coastal road',
      announcementUrl: 'https://www.dpwh.gov.ph/dpwh/node/40002',
      summary:
        'A road closure will be implemented along the Cebu south coastal road on August 9, 2026 for bridge repair. Motorists are advised to use alternate routes.',
      guid: 'dpwh-cebu-closure',
    }),
  },
  {
    reason: 'untrusted source',
    candidate: candidate({
      sourceId: 'random-facebook-page',
      title: 'Class suspension in Malolos tomorrow, according to a post going around',
      announcementUrl: 'https://example.com/post/123',
      summary: 'Classes in Malolos are reportedly suspended tomorrow. All residents are advised to check.',
      guid: 'unofficial-post',
    }),
  },
  {
    reason: 'link points away from the source',
    candidate: candidate({
      sourceId: 'malolos-city-website',
      title: 'Suspension of classes in the City of Malolos tomorrow',
      announcementUrl: 'https://malicious.example.net/phish',
      summary: 'Classes in all levels in the City of Malolos are suspended tomorrow. All residents are advised.',
      guid: 'hijacked-link',
    }),
  },
  {
    reason: 'procurement notice, not a civic announcement',
    candidate: candidate({
      sourceId: 'dpwh-advisories',
      title: 'FY 2026 Updated Annual Procurement Plan Non-CSE Version No. 8',
      announcementUrl: 'https://www.dpwh.gov.ph/dpwh/node/40003',
      summary: 'The updated annual procurement plan for fiscal year 2026 is now available for download.',
      guid: 'dpwh-app-v8',
    }),
  },
];

/** Bulk filler used to test the twenty post-it limit. */
export function fillerCandidates(count, { startHours = 4, spacingHours = 0.5 } = {}) {
  const barangays = [
    'Anilao', 'Atlag', 'Bulihan', 'Caniogan', 'Catmon', 'Dakila', 'Guinhawa',
    'Ligas', 'Longos', 'Look 1st', 'Lugam', 'Mabolo', 'Matimbo', 'Niugan',
    'Panasahan', 'San Agustin', 'San Gabriel', 'Santiago', 'Sumapang Matanda',
    'Taal', 'Tikay', 'Bangkal', 'Barihan', 'Calero', 'Canalate',
  ];
  return Array.from({ length: count }, (_, index) => {
    const barangay = barangays[index % barangays.length];
    return candidate({
      sourceId: 'malolos-city-website',
      title: `Water service interruption in Barangay ${barangay}, City of Malolos`,
      announcementUrl: `https://www.cityofmalolos.gov.ph/announcements/water-${index}-${barangay
        .toLowerCase()
        .replace(/\s+/g, '-')}`,
      summary: `Please be advised that a water service interruption will affect Barangay ${barangay} in the City of Malolos due to scheduled maintenance of the distribution line. All residents of the barangay are advised to store enough water for the day.`,
      publishedAt: isoAgo(startHours + index * spacingHours),
      guid: `filler-${index}-${barangay}`,
    });
  });
}
