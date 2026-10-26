# SwimDeck

Follow your swimmers: personal bests, top times, season bests and progression from
[Tempus Open](https://www.tempusopen.se). Works on phones and desktops, in Swedish, English, Finnish and Norwegian.

- Search Tempus Open and build your own list of swimmers (or paste a Tempus link)
- Each swimmer card shows new PBs this season, the latest season best and best events
- Per event: personal best, period best, top 3/5/10/all swims and a progression chart
- Biggest improvement against the personal best before the period
- A Meets tab with every swim, newest meet first, PBs marked; season bests per event
- Tap a meet to see its result list for that event, with places worked out per round
- Rankings within your list: per event, period best, AQUA points or improvement; one distance in both pools side by side
- Compare up to four swimmers event by event; export rankings and comparisons as CSV
- Sort or drag cards, minimise them, remove with undo and a 30-day trash
- Qualifying times 2026 (SM/U21-SM, USM, Para-SM) from Svensk Simidrott: badges on cards and events,
  time left to the next standard, and a Qualifying tab with an overview of every standard reached and all times
- Short help in each view and an About page with the swimming terms explained
- Swimmer profile (strokes, sprint/middle/distance), form, prognosis towards the next qualifying time,
  head-to-head between two swimmers, national ranking by birth year
- WPS points (World Para Swimming 2024, long course) for swimmers with a para class: event table, best events, all-events ranking
- Swims as a percentage of the current world record (any age): in the event view and as a ranking
- Masters: swims as a percentage of the World Aquatics masters world record for the age group (from 25), on cards, in tables and as a ranking
- Personal goals per event, shown on cards, in the event table and as a line in the progression chart
- Installable, works offline with the last fetched data
- Sync the list between devices with a secret link or QR code (no account; only Tempus ids, order and para class are stored)
- Import swimmers from a pasted start list or result list (Swimify, PDF, e-mail): pick by event, club or swimmer
- Import swimmers from a meet in Tempus: pick the meet and club, then by birth year, event or swimmer
- Push notifications when a swimmer in your list sets a new personal best (checked every 6 hours)
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
| `GET /api/meet?name=&date=&code=&sex=` (or `id=`) | result list for one event at a meet, with places per round |
| `GET /api/meets?name=` | competitions in the last year (to import from) |
| `GET /api/meet/:id/swimmers?club=` | swimmers at a meet: clubs first, then one club's swimmers (or all on small meets) |
| `GET /api/records` | current world records (refreshed daily from World Aquatics) and the latest masters list date |
| `GET /api/rank?event=&sex=&born=&from=&to=&time=` | place in Sweden among swimmers born the same year |
| `GET /api/push/key`, `POST`/`DELETE /api/push`, `POST /api/push/test` | push notification subscriptions (checked by a cron trigger) |
| `POST /api/sync`, `GET/PUT/DELETE /api/sync/:token` | synced list (Cloudflare KV, created by the deploy workflow) |

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
