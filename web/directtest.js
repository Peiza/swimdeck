// A diagnostic page, not part of the app: can this device read a Tempus Open page directly?
// Step 1 (no-cors) tells whether the site can be reached at all from here.
// Step 2 (cors) tells whether Tempus lets a page on another site read the answer.
const URL_ = 'https://www.tempusopen.se/swimmers';
const out = document.getElementById('out');
const log = (s) => { out.textContent += s + '\n'; };

document.getElementById('run').addEventListener('click', async () => {
  out.textContent = '';
  log(`Enhet: ${navigator.userAgent}`);
  log(`Tid: ${new Date().toISOString()}`);
  try {
    const r = await fetch(URL_, { mode: 'no-cors', credentials: 'omit' });
    log(`1. Nå sidan (no-cors): ${r.type} (anropet gick fram)`);
  } catch (e) {
    log(`1. Nå sidan (no-cors): misslyckades (${e.name}). Sidan nås inte härifrån.`);
  }
  try {
    const r = await fetch(URL_, { mode: 'cors', credentials: 'omit' });
    const text = await r.text();
    log(`2. Läsa svaret (cors): status ${r.status}, ${text.length} tecken. Det fungerar att läsa direkt.`);
  } catch (e) {
    log(`2. Läsa svaret (cors): blockerat (${e.name}). Tempus tillåter inte att en annan webbplats läser svaret.`);
  }
  log('Klart. Skicka texten ovan till utvecklaren.');
});
