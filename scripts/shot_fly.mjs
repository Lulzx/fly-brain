import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto('http://localhost:5173/arena.html', { waitUntil: 'load' });
await p.waitForFunction(() => window.__arena && window.__arena.flies[0]?.last, null, { timeout: 120000 });
await p.evaluate(() => { const { camera, controls } = window.__arena; document.querySelector('#follow').checked = false; controls.target.set(0, 0, 0.1); camera.position.set(0.25, -0.35, 0.28); controls.update(); document.querySelector('#panel').style.display = 'none'; });
await p.waitForTimeout(1500); await p.screenshot({ path: '/tmp/fly_close.png' }); await b.close();
