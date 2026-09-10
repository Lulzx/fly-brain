import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
p.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
p.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await p.goto('http://localhost:5173/', { waitUntil: 'load' });
for (let i = 0; i < 60; i++) { await p.waitForTimeout(2000); const s = await p.$('#status'); if (!s) break; console.log('status:', await s.textContent()); }
console.log('summary:', await p.textContent('#summary'));
if (process.argv[2] !== 'noplay') {
  await p.selectOption('#groupKind', 'class'); await p.fill('#groupQuery', 'olfactory'); await p.click('#addDrive');
  await p.click('#play'); await p.waitForTimeout(5000);
  console.log('stats:', await p.textContent('.stats'));
  console.log('drives:', await p.textContent('#drives'));
}
await p.screenshot({ path: '/tmp/shot1.png' });
console.log(logs.join('\n'));
await b.close();
