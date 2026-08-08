# Notices recorded by hand

Some official offices publish only on Facebook. The Malolos City Information
Office page is the clearest example, and for a board about Malolos it is the
single most valuable source there is.

Facebook does not allow it to be read automatically. Its `robots.txt` states
that collection of data through automated means is prohibited without express
written permission from Meta, and the page itself returns a login wall with no
post text to an ordinary request. AlertoMalolos therefore does not crawl it, and
a test in `test/curated.test.js` fails the build if any source is ever
configured to fetch a Facebook page.

There are two honest ways in. Both end at the same place: an entry judged by
exactly the same rules as every other source.

---

## Route 1 — Record the notice by hand (works today)

You read the post, paste its wording into the board, and the board keeps the
link to the original.

```bash
npm run add -- \
  --url "https://www.facebook.com/MalolosCIOPage/posts/1234567890" \
  --title "Suspension of classes in all levels on August 9, 2026" \
  --text "PAALALA SA PUBLIKO: Suspendido ang klase sa lahat ng antas ..." \
  --published "2026-08-08 19:30"
```

The command checks the entry before writing anything and tells you the verdict:

```
  Suspension of classes in all levels on August 9, 2026
  https://www.facebook.com/MalolosCIOPage/posts/1234567890
  published: Aug 8, 2026, 7:30 PM

  Accepted as: suspension, score 93
  Snippet on the alert:
    "PAALALA SA PUBLIKO: Suspendido ang klase sa lahat ng antas sa lahat ng
     pampubliko at pribadong paaralan sa Lungsod ng Malolos bukas, ..."
```

If the rules would reject it, nothing is written and you are told why:

```
  The rules would reject this: reads-as-news (congratulations)
```

That is the point. A hand-recorded notice gets no special treatment: a
congratulatory post from the information office is refused exactly as a
congratulatory post from the provincial feed is refused.

Then commit and push:

```bash
git add data/curated.json && git commit -m "Add CIO notice: class suspension" && git push
```

### The rules you are agreeing to

**Paste the wording, do not write your own.** Copy the post's text as published.
The board shortens text at sentence boundaries by itself; it never needs a
summary from you. If you find yourself rewriting a sentence to make it clearer,
stop — that is the moment the board stops being trustworthy.

**Do not translate.** A Filipino notice stays in Filipino. The rules read both
languages.

**Do not fix the dates.** If a post says "bukas", leave "bukas" and set
`--published` to when it was posted. The board works out the expiry from that.

**One post, one entry.** If the office posts a correction, add the correction as
its own entry with its own link; duplicate detection will keep one alert and
credit the more authoritative source.

**If you are unsure, leave it off.** A missing notice is a smaller failure than
a wrong one.

### Every reader is told

A notice recorded this way carries a line on its detail page:

> This notice was recorded from the official post by hand, because that page
> cannot be read automatically. Open the original post for the exact wording.

The alert still shows the City Information Office as the source, and the link
still opens the original post. Nobody is misled about where the words came
from.

### Other commands

```bash
npm run add -- --list
```

```bash
npm run add -- --check --url "..." --title "..." --text "..."
```

```bash
npm run add -- --remove "https://www.facebook.com/MalolosCIOPage/posts/1234567890"
```

`--check` validates without writing. `--file notice.txt` reads the text from a
file, which is easier than escaping a long quote in the shell. `--force` records
an entry the rules reject — it still will not be posted unless it passes at
update time, so this is only useful for staging something before its date.

### Housekeeping

Entries stay in `data/curated.json` until you remove them. They do not need
removing to come off the board — an expired notice is taken down automatically
and, because it is remembered as retired, an unchanged entry is not re-posted.
Clearing out old entries every few months keeps the file readable.

---

## Route 2 — A Page access token (better, if you can get one)

If the information office's administrators are willing, they can issue a
long-lived Page access token from the Meta Business Suite. With one, the board
reads the page's posts through the Graph API on the same hourly cycle as
everything else, with no manual step.

This is the sanctioned route: it is Meta's own interface, used with the page
owner's permission, rather than collection they have prohibited.

What to ask the office for: a **long-lived Page access token** for the
*Malolos City Information Office* page with the `pages_read_engagement`
permission. A token from a Meta app that the office's administrator has
authorised for their page.

Then set it as described in
[DEPLOYMENT.md, Step 6](DEPLOYMENT.md#step-6--optional-the-city-information-office-page-token).
The `malolos-cio-graph` source switches itself on when the token exists and
stays off when it does not.

What the board asks the API for, and nothing else:

```
message, created_time, updated_time, permalink_url, id
```

No comments, no reactions, no author details, no images. A post with no text is
skipped, because a photograph with no caption cannot be verified as an
announcement. The first sentence of the post becomes the alert title, word for
word, and the rest is available in the detail view.

When both routes are active, duplicate detection keeps a single alert: the
same notice arriving through the API and by hand is recognised as one
announcement.

---

## Adding a different Facebook-only office

The same pattern works for the Malolos CDRRMO or a barangay page. Add a registry
entry in `config/sources.js`:

```js
{
  id: 'malolos-cdrrmo-facebook',
  name: 'Malolos City Disaster Risk Reduction and Management Office',
  publicDescription: 'Disaster advisories and evacuation information.',
  tier: 2,
  scope: 'malolos',
  kind: 'manual',
  homepage: 'https://www.facebook.com/<their-page>',
  url: 'https://www.facebook.com/<their-page>',
  file: 'data/curated.json',
  linkPattern: /^https:\/\/(www\.|m\.)?facebook\.com\/<their-page>/i,
  transcribed: true,
  allowEmpty: true,
  enabled: true,
}
```

`linkPattern` is the important part: it is what stops a mistyped link from
pointing anywhere other than that office's own page. Then record entries against
it with `--source malolos-cdrrmo-facebook`.

---

**AlertoMalolos** — a civic information project by Benedict de Jesus.
