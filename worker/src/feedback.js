// Feedback from the app: a short message, optionally with device details the visitor chose to
// send, turned into an issue in a private GitHub repository (FEEDBACK_REPO) with a token that can
// only create issues there (FEEDBACK_TOKEN, a Worker secret). Nothing is stored in the Worker.

const KINDS = ['bug', 'idea', 'other'];
const MAX_MESSAGE = 2000;
const DEVICE_KEYS = ['version', 'lang', 'browser', 'os', 'screen', 'installed', 'view'];

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

const oneLine = (v, max) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

/** Keep only well-formed fields. Returns null for a honeypot hit (a bot), which is dropped silently. */
export function cleanFeedback(input) {
  if (!input || typeof input !== 'object') throw bad('Missing feedback');
  if (typeof input.website === 'string' && input.website) return null;
  const message = String(input.message ?? '').trim();
  if (message.length < 3) throw bad('Write a few words');
  if (message.length > MAX_MESSAGE) throw bad('The message is too long');
  const kind = KINDS.includes(input.kind) ? input.kind : 'other';
  const contact = oneLine(input.contact, 120);
  let device = null;
  if (input.device && typeof input.device === 'object') {
    device = {};
    for (const k of DEVICE_KEYS) if (input.device[k] != null && input.device[k] !== '') device[k] = oneLine(input.device[k], 100);
  }
  return { kind, message, contact, device };
}

export function issueFor(f) {
  const first = f.message.replace(/\s+/g, ' ').slice(0, 60);
  const lines = [f.message, ''];
  if (f.contact) lines.push(`**Contact:** ${f.contact}`);
  if (f.device && Object.keys(f.device).length) {
    lines.push('', '**Device (sent with permission)**');
    for (const [k, v] of Object.entries(f.device)) lines.push(`- ${k}: ${v}`);
  }
  return { title: `[${f.kind}] ${first}`, body: lines.join('\n'), labels: [f.kind] };
}

export async function handleFeedback(request, env) {
  if (request.method !== 'POST') throw bad('Method not allowed', 405);
  if (!env.FEEDBACK_TOKEN || !env.FEEDBACK_REPO) throw bad('Feedback is not set up', 503);
  let input;
  try {
    input = await request.json();
  } catch {
    throw bad('Invalid JSON');
  }
  const f = cleanFeedback(input);
  if (!f) return { ok: true }; // honeypot
  const res = await fetch(`https://api.github.com/repos/${env.FEEDBACK_REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.FEEDBACK_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'swimdeck-api',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(issueFor(f)),
  });
  if (!res.ok) {
    console.log('feedback failed', res.status);
    throw bad('Could not send the feedback', 502);
  }
  return { ok: true };
}
