import jsdomPkg from 'jsdom';
const { JSDOM, VirtualConsole } = jsdomPkg;
const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', (e) => errs.push(e.message));
const dom = await JSDOM.fromURL('http://127.0.0.1:8080/reviews.html?date=2026-08-28', {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) { w.fetch = w.fetch || (() => Promise.resolve({ ok: false, status: 404, json: async () => ({}) })); },
});
await new Promise((r) => setTimeout(r, 12000));
const d = dom.window.document;
const t = (id) => (d.getElementById(id) ? d.getElementById(id).textContent.replace(/\s+/g, ' ').trim() : '(missing)');
console.log('status   :', t('status-line').slice(0, 300));
console.log('latency  :', t('latency-chip-slot'));
console.log('state hd :', t('state-section').slice(0, 220));
console.log('state card:', (d.querySelector('.state-card') || {}).textContent ? d.querySelector('.state-card').textContent.replace(/\s+/g,' ').slice(0,320) : '(none)');
console.log('feed rows:', d.querySelectorAll('#feed-list .feed-row').length);
console.log('scoring  :', t('scoring-section').slice(0, 160), '| rows', d.querySelectorAll('#scoring-section .scoring-row').length);
console.log('net      :', JSON.stringify(dom.window.ReplayFeed.state.net));
console.log('errors   :', errs.slice(0, 4));
dom.window.close();
