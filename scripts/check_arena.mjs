import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const logs = []; p.on('console', m => logs.push(`[${m.type()}] ${m.text()}`)); p.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await p.goto('http://localhost:5173/arena.html', { waitUntil: 'load' });
for (let i = 0; i < 90; i++) { await p.waitForTimeout(1000); const s = await p.$('#status'); if (!s) break; if (i % 5 === 0) console.log('status:', await s.textContent()); }
console.log('isolated:', await p.evaluate(() => crossOriginIsolated));
await p.waitForTimeout(3000);
await p.click('#play');
const secs = +(process.argv[2] || 20);
for (let i = 0; i < secs; i += 5) { await p.waitForTimeout(5000); console.log('sim t', await p.textContent('#simt'), 'rt', await p.textContent('#rt'), 'fps', await p.textContent('#fps')); }
console.log(await p.textContent('#sel'));
await p.screenshot({ path: '/tmp/arena.png' });
console.log(logs.filter(l => !/vite/.test(l)).slice(-15).join('\n'));
await b.close();
