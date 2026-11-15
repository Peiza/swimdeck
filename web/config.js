// Address of the SwimDeck API (the Cloudflare Worker).
// - On localhost the dev server (tools/dev-server.js) provides /api itself.
// - On localhost only, ?api=<url> overrides it, handy for testing another Worker. Never on the public site:
//   a crafted link must not be able to point the app at someone else's server.
// - The deploy workflow can override it with the repository variable SWIMDECK_API_URL.
const local = ['localhost', '127.0.0.1'].includes(location.hostname);

export const CONFIG = {
  api: (local && new URLSearchParams(location.search).get('api')) || (local ? '' : 'https://swimdeck-api.peiza.workers.dev'),
};
