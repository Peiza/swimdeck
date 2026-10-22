// The Ko-fi support line. A plain link (no Ko-fi script, widget or image),
// opened in the same tab, with a small cup icon drawn here so it follows the theme.

export const KOFI_URL = 'https://ko-fi.com/peiza';

const CUP = `<svg class="cup" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3.5c-.8 1 .8 1.8 0 3M12 3.5c-.8 1 .8 1.8 0 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

/** HTML for the line. `t` translates, `esc` escapes text. */
export function supportLine(t, esc) {
  const link = `<a href="${KOFI_URL}" rel="noreferrer">${esc(t('support.link'))}</a>`;
  const [before, after = ''] = t('support.text').split('{link}');
  return `<p class="support">${CUP}<span>${esc(before)}${link}${esc(after)}</span></p>`;
}
