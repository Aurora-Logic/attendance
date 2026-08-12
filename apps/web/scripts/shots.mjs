/** Captures reference screenshots of the shell at both ends of the range. */
const CDP = process.env.VERIFY_CDP ?? 'http://localhost:9222';
const BASE = process.env.VERIFY_BASE ?? 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const fs = await import('node:fs/promises');
await send('Page.enable');

for (const [name, path, w, h] of [
  ['dashboard-desktop', '/', 1440, 900],
  ['patterns-desktop', '/patterns', 1440, 1100],
  ['patterns-mobile', '/patterns', 360, 740],
  ['dashboard-mobile', '/', 360, 740],
]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: w < 768,
  });
  await send('Page.navigate', { url: `${BASE}${path}` });
  await sleep(2500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(`/tmp/vyuha-${name}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`wrote /tmp/vyuha-${name}.png`);
}
process.exit(0);
