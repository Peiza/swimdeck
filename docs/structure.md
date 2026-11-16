# How the web app is organised

`web/app.js` starts the app: it draws the page frame, registers the global event handlers and wires the modules together. The rest lives in modules, so a change stays in one place.

| File | What it holds |
| --- | --- |
| `core.js` | The one `state` object, local storage (`store`), the translator `t`, `esc`, `$`, toast messages and `hooks` |
| `api.js` | Calls to the SwimDeck API: loading swimmers, refreshing the list, loading events |
| `sync.js` | Sync between devices (secret link, merging, the dialog) and its clicks |
| `notify.js` | Push notifications: subscribing and keeping the server's list in step |
| `add.js` | Adding swimmers: search, pasted list and a meet in Tempus |
| `lists.js` | Share link, remove, trash, remove several and undo |
| `views.js` | The four main views (swimmers, top list, compare, qualifying) and the swimmer cards |
| `swimmer.js` | The swimmer dialog: events, meets, profile and para class |
| `meets.js` | Meet result lists, event rows, rankings, records and the season chart |
| `viewkit.js` | Small helpers for the views: the points column choice, menus and period names |
| `parts.js` | Qualification labels, "new since last visit" and icons shared by several views |
| `reorder.js` | Drag and keyboard reordering of cards |
| `lib.js`, `qual.js`, `wps.js`, `masters.js`, `importer.js` | Pure logic with unit tests |

## Rules that keep it safe

- Modules never import `app.js`. When one needs a redraw it calls `hooks.render()`, `hooks.renderMain()` and so on; `app.js` registers them in one `Object.assign(hooks, {...})`. `web/test/hooks.test.js` fails if a hook is used but not registered.
- Click handling is split by area: each module exports an `onXClick(el, e)` that returns `true` when it handled the click, and `app.js` calls them in turn.
- `npm run check` (and `npm test`) finds identifiers that are used but not declared, and imports of names a module does not export. Run it after moving code.
