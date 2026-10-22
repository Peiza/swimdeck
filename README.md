# SwimDeck

Follow your swimmers: personal bests, top times, season bests and progression from
[Tempus Open](https://www.tempusopen.se). Works on phones and desktops, in Swedish, English and Finnish.

- Search Tempus Open and build your own list of swimmers (or paste a Tempus link)
- Each swimmer card shows new PBs this season, the latest season best and best events
- Per event: personal best, period best, top 3/5/10/all swims and a progression chart
- Biggest improvement against the personal best before the period
- A Meets tab with every swim, newest meet first, PBs marked; season bests per event
- Rankings within your list: per event, period best, AQUA points or improvement
- Compare up to four swimmers event by event; export rankings and comparisons as CSV
- Sort or drag cards, minimise them, remove with undo and a 30-day trash
- Share your list as a link

SwimDeck is not affiliated with Tempus Open or the Swedish Swimming Federation.
Nothing is stored on a server: your list lives in your browser, and results are fetched
from Tempus Open when you ask for them (briefly cached to keep the load on Tempus low).

## How it works

```
web/      static app (GitHub Pages)       ──►  worker/  small API (Cloudflare Worker)  ──►  tempusopen.se
```

Browsers cannot call Tempus Open from another site, so a tiny Worker fetches the pages,
reads the JSON that Tempus Open embeds in them and returns a compact shape:

| Route | Returns |
|---|---|
| `GET /api/search?first=&last=&club=` | matching swimmers |
| `GET /api/swimmer/:id?from=YYYY-MM-DD&to=YYYY-MM-DD` | best time per event (all time, or within dates) |
| `GET /api/swimmer/:id/event/:code` | every swim in one event, fastest first |

All routes take `site=se` (default) or `site=fi`. Times are in hundredths of a second.
Event codes: odd = 25 m pool, even = 50 m pool (11/12 = 50 m freestyle, 13/14 = 100 m freestyle …).

## Run locally

Requires Node 20+. No dependencies to install.

```sh
npm run dev        # http://localhost:8080 with live data from Tempus Open
npm run dev:mock   # same app with invented swimmers, no network needed
npm test
```

## Deploy

1. **Web app** – in the repository settings, *Pages → Source: GitHub Actions*.
   Every push to `main` that touches `web/` publishes the app.
2. **API** – create a free Cloudflare account and an API token from the
   *Edit Cloudflare Workers* template. Add two repository secrets:
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then run the
   *Deploy API* workflow. It prints the Worker address (`https://swimdeck-api.<you>.workers.dev`).
3. **Connect them** – the API address is set in `web/config.js`. A repository *variable*
   `SWIMDECK_API_URL` overrides it at deploy time (useful for forks).

Live app: https://peiza.github.io/swimdeck/

The footer shows the version from `package.json` and the publish date, both written
into `version.js` by the deploy workflow. Bump `version` in `package.json` for each release.

Allowed web origins for the API are set in `worker/wrangler.toml` (`ALLOWED_ORIGINS`).

## Support

Like SwimDeck? [Buy me a coffee on Ko-fi](https://ko-fi.com/peiza).

The app has the same plain link at the bottom of the page, opened in the same tab.
There is no Ko-fi button, widget or script, so nothing from Ko-fi loads in the app.

## Roadmap

See [docs/PLAN.md](docs/PLAN.md).
