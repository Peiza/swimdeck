#!/usr/bin/env node
// Used by the deploy workflow: makes sure the KV namespace for synced lists exists
// and adds its binding to worker/wrangler.toml (only in the CI checkout, not committed).
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
import { appendFileSync, readFileSync } from 'node:fs';

const TITLE = 'swimdeck-lists';
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!token || !account) {
  console.log('::warning::Cloudflare credentials missing, skipping KV setup (sync will be unavailable).');
  process.exit(0);
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json();
  if (!body.success) throw new Error(`Cloudflare API: ${JSON.stringify(body.errors)}`);
  return body.result;
};

let ns = (await api('?per_page=100')).find((n) => n.title === TITLE);
if (!ns) {
  ns = await api('', { method: 'POST', body: JSON.stringify({ title: TITLE }) });
  console.log(`Created KV namespace ${TITLE}`);
} else {
  console.log(`Using KV namespace ${TITLE}`);
}

const toml = new URL('../worker/wrangler.toml', import.meta.url);
if (!readFileSync(toml, 'utf8').includes('binding = "LISTS"')) {
  appendFileSync(toml, `\n[[kv_namespaces]]\nbinding = "LISTS"\nid = "${ns.id}"\n`);
}
