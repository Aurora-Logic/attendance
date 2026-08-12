/**
 * Smoke-drives the running web app over the Chrome DevTools Protocol.
 *
 * Why this exists: a passing typecheck and a 200 from the dev server both told
 * us the shell worked while the page was in fact blank, and later while a
 * render loop was spinning. Every probe here is written so it can only pass
 * for the right reason — a React container key on #root rather than "some
 * HTML exists", real overflow arithmetic rather than a screenshot glance, and
 * synthesised keystrokes through Input.dispatchKeyEvent rather than calling
 * application code directly.
 *
 * Usage:
 *   pnpm dev                       # in one shell
 *   chrome --remote-debugging-port=9222 --headless=new --user-data-dir=/tmp/x
 *   node scripts/verify-ui.mjs
 */

const BASE = process.env.VERIFY_BASE ?? 'http://localhost:5173';
const CDP = process.env.VERIFY_CDP ?? 'http://localhost:9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`${CDP}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Chrome is not listening yet.
    }
    await sleep(250);
  }
  throw new Error(`No CDP page target on ${CDP}`);
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.consoleErrors.push(msg.params.entry.text.slice(0, 300));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.exceptions.push((d.exception?.description ?? d.text).slice(0, 300));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(
          msg.params.args.map((a) => a.description ?? a.value ?? '').join(' ').slice(0, 300),
        );
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        `Eval threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`,
      );
    }
    return res.result.value;
  }

  /** modifiers bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8 */
  async key(code, key, modifiers = 0) {
    const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : key === 'F1' ? 112 : 0;
    await this.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      code,
      key,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, modifiers });
  }

  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
  }

  async goto(path) {
    this.consoleErrors.length = 0;
    this.exceptions.length = 0;
    await this.send('Page.navigate', { url: `${BASE}${path}` });
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      const mounted = await this.eval(
        `(() => { const r = document.getElementById('root');
           return !!r && Object.keys(r).some(k => k.startsWith('__reactContainer')) && r.innerHTML.length > 0; })()`,
      ).catch(() => false);
      if (mounted) {
        await sleep(250);
        return true;
      }
    }
    return false;
  }
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
const s = new Session(ws);
await s.send('Page.enable');
await s.send('Runtime.enable');
await s.send('Log.enable');

// ---------------------------------------------------------------- desktop
await s.viewport(1440, 900);
check('React mounts on /', await s.goto('/'), 'react container key on #root');

check(
  'Sidebar renders permission-filtered nav',
  (await s.eval(`document.querySelectorAll('[data-slot="sidebar"] a[href]').length`)) === 16,
  `${await s.eval(`document.querySelectorAll('[data-slot="sidebar"] a[href]').length`)} links for Admin`,
);

const groups = await s.eval(
  `JSON.stringify([...document.querySelectorAll('[data-slot="sidebar-group-label"]')].map(e => e.textContent.trim()))`,
);
check('Nav groups match PRD 6.1', groups === '["Work","Records","Reports","Setup"]', groups);

check(
  'Page header renders',
  (await s.eval(`document.querySelector('main h1')?.textContent`)) === 'Dashboard',
  'h1 = Dashboard',
);

const ov = await s.eval(
  `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
);
check('No horizontal overflow at 1440px', ov <= 0, `${ov}px`);

check(
  'No text stuck invisible',
  (await s.eval(
    `[...document.querySelectorAll('main *')].filter(e => !e.children.length && e.textContent.trim()).filter(e => getComputedStyle(e).opacity === '0').length`,
  )) === 0,
  'zero zero-opacity leaves',
);

// ------------------------------------------------- Alt+G Go To (REQ-N-01)
await s.key('KeyG', 'g', 1);
await sleep(700);
check(
  'Alt+G opens the Go To palette',
  (await s.eval(`!!document.querySelector('[data-slot="command-input"], input[cmdk-input]')`)) === true,
);
const items = await s.eval(
  `document.querySelectorAll('[cmdk-item], [data-slot="command-item"]').length`,
);
check('Palette is permission-filtered and populated', items === 16, `${items} items`);

await s.key('Escape', 'Escape');
await sleep(500);
check(
  'Esc closes the palette',
  (await s.eval(`!document.querySelector('[data-slot="command-input"], input[cmdk-input]')`)) === true,
);

// ------------------------------------------ Ctrl+F1 / F1 sheet (REQ-N-04)
await s.key('F1', 'F1');
await sleep(700);
check(
  'F1 opens the shortcut reference sheet',
  (await s.eval(`document.body.textContent.includes('Keyboard shortcuts')`)) === true,
);
const chips = await s.eval(`document.querySelectorAll('[data-slot="kbd"]').length`);
check('Sheet lists shortcuts as hint chips', chips >= 4, `${chips} kbd chips`);
await s.key('Escape', 'Escape');
await sleep(500);

// ------------------------------------------------ demo form (Phase 0 gate)
check('Patterns route mounts', await s.goto('/patterns'));
check(
  'Table pattern renders rows',
  (await s.eval(`document.querySelectorAll('table tbody tr').length`)) === 4,
  '4 rows',
);

await s.eval(`document.getElementById('demo-name').focus(); true`);
await s.eval(
  `(() => { const el = document.getElementById('demo-name');
     const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
     set.call(el, 'Test Person');
     el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
);
check(
  'Form field accepts input',
  (await s.eval(`document.getElementById('demo-name').value`)) === 'Test Person',
);

// Technical design 9: Ctrl+A must still fire while a text field has focus.
await s.key('KeyA', 'a', 2);
await sleep(800);
check(
  'Ctrl+A saves from inside a focused field',
  (await s.eval(`document.body.textContent.includes('Demo record saved')`)) === true,
);
check(
  'Save clears the form',
  (await s.eval(`document.getElementById('demo-name').value === ''`)) === true,
);

// --------------------------------------------------------------- 360px
await s.viewport(360, 740);
await s.goto('/patterns');
const ov360 = await s.eval(
  `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
);
check('No horizontal overflow at 360px', ov360 <= 0, `${ov360}px`);

check(
  'Table collapses below 768px',
  (await s.eval(
    `(() => { const t = document.querySelector('table'); return !t || t.closest('div').offsetParent === null; })()`,
  )) === true,
  'PRD 6.5 stacked rows, not a sideways scroll',
);
check(
  'Stacked record rows render',
  (await s.eval(
    `[...document.querySelectorAll('div')].filter(d => typeof d.className === 'string' && d.className.includes('min-h-[3.25rem]')).length`,
  )) === 4,
  '4 stacked rows',
);
check(
  'No sub-24px touch targets at 360px',
  (await s.eval(
    `[...document.querySelectorAll('button, a[href], [role="button"]')]
       .filter(e => e.offsetParent !== null)
       .map(e => e.getBoundingClientRect())
       .filter(r => r.height > 0 && r.height < 24).length`,
  )) === 0,
);

// ------------------------------------------------------------ console
check('No console errors', s.consoleErrors.length === 0, s.consoleErrors.slice(0, 2).join(' | ') || 'clean');
check('No uncaught exceptions', s.exceptions.length === 0, s.exceptions.slice(0, 2).join(' | ') || 'clean');

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILURES:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);
