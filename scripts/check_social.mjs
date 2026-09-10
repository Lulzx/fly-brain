import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const logs = []; p.on('console', m => logs.push(`[${m.type()}] ${m.text()}`)); p.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await p.goto('http://localhost:5173/arena.html?env=' + (process.argv[2] || 'social'), { waitUntil: 'load' });
await p.waitForFunction(() => window.__arena && window.__arena.flies.length >= +(new URLSearchParams(location.search).get('n') || 1) && window.__arena.flies.every(f => f.last), null, { timeout: 240000 });
await p.waitForTimeout(3000); await p.click('#play');
for (let i = 0; i < 4; i++) { await p.waitForTimeout(5000); console.log('sim t', await p.textContent('#simt'), 'rt', await p.textContent('#rt'), 'flies', await p.textContent('#nfly')); }
console.log((await p.textContent('#flies')).replace(/\s+/g, ' ').slice(0, 400));
await p.evaluate(() => { const { camera, controls } = window.__arena; document.querySelector('#follow').checked = false; controls.target.set(0, 0, 0); camera.position.set(0, -3.2, 3.4); controls.update(); });
await p.waitForTimeout(800); await p.screenshot({ path: '/tmp/social.png' });
console.log(logs.filter(l => /error/i.test(l)).slice(-5).join('\n'));
await b.close();
