// Address of the SwimDeck API (the Cloudflare Worker).
// The deploy workflow overwrites this file with the repository variable SWIMDECK_API_URL.
// '' means "same origin", which is what the local dev server (tools/dev-server.js) provides.
export const CONFIG = {
  api: new URLSearchParams(location.search).get('api') ?? '',
};
