# Putting AlertoMalolos online

A walkthrough for hosting the board on GitHub Pages, with the hourly update
running by itself. Start to finish it takes about fifteen minutes, and it costs
nothing: public repositories get free Pages hosting and free Actions minutes.

You need a GitHub account and the repository at
`github.com/benedict-dejesus/AlertoMalolos`. Nothing has to be installed on a
server, and no database is involved — the board is plain files.

---

## What is about to happen

Every hour, GitHub runs the update on its own machine:

```
GitHub's scheduler wakes the workflow
  → it checks out the repository
  → runs the tests
  → checks the official sources
  → rebuilds the pages in public/
  → commits the new board back to the repository
  → publishes public/ to the web
```

If a source is down, that source is skipped and the board keeps what it had.
If the tests fail, nothing is published and the previous site stays up.

---

## Step 1 — Set the public address

Before the first deployment, tell the site where it will live. Open
[`config/site.js`](../config/site.js) and set `origin` and `basePath`:

```js
export const SITE = {
  // ...
  origin: 'https://benedict-dejesus.github.io/AlertoMalolos',
  basePath: '/AlertoMalolos',
};
```

Use the form `https://<your-username>.github.io/<repository-name>`. If you will
put the board on your own domain later, Step 8 covers it.

These two values only affect the canonical link, the sitemap and the social
preview. Getting them wrong will not break the pages.

## Step 2 — Push the project

```bash
git add -A
```

```bash
git commit -m "AlertoMalolos: civic announcement board"
```

```bash
git push origin main
```

The repository must be **public** for free Pages hosting. If it is private, you
need a GitHub Pro plan for Pages, or you can make it public — there is nothing
secret in it. (A Facebook page token, if you use one, is stored separately in
Step 6, never in the code.)

## Step 3 — Turn on Pages

1. Open the repository on github.com
2. **Settings** (top row of the repository, not your account settings)
3. **Pages**, in the left sidebar
4. Under **Build and deployment → Source**, choose **GitHub Actions**

Do not choose "Deploy from a branch". The workflow uploads the site itself, and
the branch option would fight with it.

There is no Save button on that screen; the choice takes effect immediately.

## Step 4 — Allow the workflow to write

The update commits the refreshed board back to the repository, so it needs write
permission.

1. **Settings → Actions → General**
2. Scroll to **Workflow permissions**
3. Select **Read and write permissions**
4. **Save**

If you skip this, the run fails at the commit step with
`remote: Permission to ... denied to github-actions[bot]`.

## Step 5 — Run it once by hand

Do not wait for the hour to turn.

1. **Actions** tab
2. Select **Update the board** in the left sidebar
3. **Run workflow** → the green **Run workflow** button

The first run takes two to three minutes. Watch it: click into the run and open
the **update** job to see each step. You are looking for:

```
Run the tests                      ✓
Check official sources and rebuild ✓
Commit the new board state         ✓
Upload the site                    ✓
deploy                             ✓
```

When the **deploy** job finishes, the address appears on **Settings → Pages**
and on the workflow run itself. Open it. An empty board with
"No major announcements right now." is a correct first result — it means the
sources were checked and nothing qualified.

> **If Actions is disabled** on a new repository, the Actions tab will say so.
> Click **I understand my workflows, go ahead and enable them**.

## Step 6 — Optional: the Facebook page tokens

The board reads an office's Facebook page only if a Page access token is
configured, because Facebook does not permit its pages to be collected
automatically without permission. Without a token, notices from those pages are
recorded by hand instead — see [CURATED-SOURCES.md](CURATED-SOURCES.md).
Nothing breaks either way.

Two pages are registered, each with its own secret:

| Page | Secret |
| --- | --- |
| Malolos City Information Office | `MALOLOS_CIO_PAGE_TOKEN` |
| Bulacan PDRRMO | `BULACAN_PDRRMO_PAGE_TOKEN` |

If a page's administrators issue you a long-lived Page access token:

1. **Settings → Secrets and variables → Actions**
2. **New repository secret**
3. Name: the secret from the table above
4. Value: the token
5. **Add secret**

Both are already passed to the update step in
[`.github/workflows/update-board.yml`](../.github/workflows/update-board.yml):

```yaml
      - name: Check official sources and rebuild the board
        run: npm run update
        env:
          MALOLOS_CIO_PAGE_TOKEN: ${{ secrets.MALOLOS_CIO_PAGE_TOKEN }}
          BULACAN_PDRRMO_PAGE_TOKEN: ${{ secrets.BULACAN_PDRRMO_PAGE_TOKEN }}
```

A secret that has never been set arrives empty, and its source simply stays
off. Each source switches itself on when its own token is present. Tokens expire; when one does, the run logs
`Graph API: Session has expired` and the rest of the board carries on
untouched.

Never paste a token into `config/sources.js` or any other file in the
repository.

## Step 7 — Check the hourly schedule

The workflow is set to run at seven minutes past every hour:

```yaml
on:
  schedule:
    - cron: '7 * * * *'
```

Three things worth knowing about GitHub's scheduler:

- **It runs in UTC.** `7 * * * *` fires every hour regardless of timezone, so
  this does not matter here; it would matter if you switched to a daily run.
- **It is not punctual.** Scheduled runs are queued, and on a busy hour GitHub
  may start yours five to twenty minutes late. The board shows the real time of
  the last check, so lateness is visible and honest rather than hidden.
- **It stops on quiet repositories.** GitHub disables scheduled workflows after
  **60 days without any commit**. Because each update commits the board, an
  active board keeps itself alive. If the board is empty for two months running,
  the schedule may be paused — GitHub emails you, and you re-enable it from the
  Actions tab.

To check it is running, look at **Actions**: you should see an hourly list of
**Update the board** runs.

## Step 8 — Optional: your own domain

If you own a domain, say `alertomalolos.ph`:

1. At your domain registrar, add a `CNAME` record for `www` pointing at
   `benedict-dejesus.github.io`
2. For the bare domain, add four `A` records pointing at `185.199.108.153`,
   `185.199.109.153`, `185.199.110.153` and `185.199.111.153`
3. **Settings → Pages → Custom domain**, enter the domain, **Save**
4. Wait for the DNS check to pass, then tick **Enforce HTTPS**
5. Add a `CNAME` file so the workflow does not wipe the setting:

```bash
echo "alertomalolos.ph" > public/CNAME
```

   and add the same line to `src/site/build.js` so it is rewritten on every
   build, next to where `.nojekyll` is written.

6. Update `SITE.origin` to `https://alertomalolos.ph` and set
   `basePath: ''`

DNS changes can take a few hours to propagate.

---

## Working alongside the hourly commits

Once the workflow is running, **GitHub is writing to your repository every
hour**. It commits `data/state.json` (the board's memory of what is already
posted) and `public/` (the built pages). Both are generated files, and the
robot owns them.

So: **pull before you work, and let the robot's copy win.**

```bash
git pull
```

If the pull reports a conflict in `data/state.json` or anything under `public/`,
do not merge it by hand — take the remote side and rebuild:

```bash
git checkout --theirs data/state.json public && npm run build
```

`.gitattributes` marks these paths `merge=binary`, so git will not write
conflict markers into them; it leaves your copy in place and tells you there is
a conflict. If a conflicted `state.json` ever does reach the update cycle, the
cycle notices, sets the file aside as `state.json.corrupt-<time>`, logs the fix,
and rebuilds the board from the sources. Nothing is lost except the memory of
what was already posted, which the next cycle restores. Those `.corrupt-` files
are ignored by git and safe to delete.

The one thing worth avoiding: running `npm run update` locally and committing
it. That is the robot's job. Locally, use the versions that write nothing to the
board:

```bash
npm run update:dry
```

```bash
npm run preview -- 14
```

The exception is `data/curated.json` — that one is yours. Edit it with
`npm run add`, commit it, and let the workflow do the rest.

## Everyday use

**Add a notice from the information office page**

```bash
npm run add -- --url "https://www.facebook.com/MalolosCIOPage/posts/123" --title "Suspension of classes on 9 August" --text "PAALALA: ..." --published "2026-08-08 19:30"
```

```bash
git add data/curated.json && git commit -m "Add CIO notice" && git push
```

The push triggers a rebuild, and the notice appears within a couple of minutes —
if it passes the rules. The command tells you before you commit.

**Change which sources are watched** — edit `config/sources.js`, push. The
workflow runs on pushes that touch `config/`, so the change takes effect at
once.

**Force an update now** — Actions → Update the board → Run workflow.

**See why something was or was not posted** — open the run, then the
**Keep the run log as an artifact** step, and download `update-log-<id>`. It
lists every source contacted, every candidate found, and the reason for every
rejection.

---

## When something goes wrong

**The deploy job fails with "Pages site not found"**
Step 3 was skipped, or Source is still set to "Deploy from a branch". Set it to
GitHub Actions and re-run.

**"Permission to ... denied to github-actions[bot]"**
Step 4. Workflow permissions must be read and write.

**The site is live but every link is broken, and the styling is gone**
`SITE.basePath` does not match the repository name, or `.nojekyll` is missing so
GitHub is hiding files. `.nojekyll` is written on every build; check it exists
in `public/`.

**The page looks half-styled — new wording, old colours**
That is a cached stylesheet: new markup being painted with the styles a browser
already had. It should no longer be possible, because the stylesheet and script
are published under names containing a hash of their contents
(`board.10a6b7a727.css`), so any change is a new address that no cache can have
seen. If you ever do see it, hard-refresh (Ctrl+Shift+R) and check that the
filename in the page's `<link rel="stylesheet">` matches the file that exists in
`public/assets/` — a test covers exactly this.

**The board is empty**
Usually correct. Confirm by reading the run log: if it shows candidates being
found and rejected, the rules are working. If every source failed, check whether
those sites are reachable.

**A source fails every hour**
Some government sites refuse automated requests, and some change their markup.
The log names the source and the reason. Either fix the selectors in
`config/sources.js` or set `enabled: false` with a `disabledReason` — it will
still be listed on the public Sources page, marked as not currently checked.

**The tests fail and nothing deploys**
That is the safety net working. Run `npm test` locally, fix the failure, push.
The previous site stays up in the meantime.

**Hourly commits are cluttering the history**
Each run commits the new "last checked" time. That is the cost of showing a
trustworthy timestamp. If you would rather not, remove the commit step — the
site still deploys from the uploaded artifact, but the board then starts from
scratch on each run and loses its memory of what is already posted, which
weakens duplicate handling. Keeping the commits is the better trade.

---

## Cost and limits

Public repositories get unlimited Actions minutes and 1 GB of Pages storage with
a 100 GB monthly bandwidth allowance. A run takes roughly two minutes, so 24
runs a day is about an hour of compute daily, all of it free on a public
repository. The site itself is around 200 KB.

---

**AlertoMalolos** — a civic information project by Benedict de Jesus.
