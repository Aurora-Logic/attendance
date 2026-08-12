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

import { readFileSync } from 'node:fs';

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
    this.navToken = 0;

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
    // The registry matches on `code`, so a wrong virtual key code would still
    // fire the shortcut - but it would stop the browser's own default, which
    // is how you tell a suppressed Page Down from a handled one.
    const NAMED_VK = { F1: 112, PageUp: 33, PageDown: 34, Escape: 27, Enter: 13, Tab: 9 };
    const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : (NAMED_VK[key] ?? 0);
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

  /**
   * Polls until an expression is truthy. A probe that reads the DOM the instant
   * a navigation resolves is racing the render, and an intermittent probe is
   * worse than no probe: it teaches you to rerun until it passes.
   */
  async waitFor(expression, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await this.eval(expression).catch(() => null);
      if (value) return value;
      if (Date.now() > deadline) return null;
      await sleep(100);
    }
  }

  async goto(path) {
    this.consoleErrors.length = 0;
    this.exceptions.length = 0;

    // Stamp the current document before navigating. Polling only for "React is
    // mounted" can be satisfied by the page we are leaving - most visibly when
    // navigating to the URL already open, where the old document stays intact
    // for a moment and every probe afterwards reads the wrong page. This is
    // exactly the failure this harness exists to catch, so it must not have it
    // itself: waiting for the stamp to disappear proves a new document.
    const token = `nav-${String(++this.navToken)}`;
    await this.eval(`window.__verifyToken = ${JSON.stringify(token)}; true`).catch(() => null);

    await this.send('Page.navigate', { url: `${BASE}${path}` });

    for (let i = 0; i < 80; i++) {
      await sleep(150);
      const ready = await this.eval(
        `(() => {
           if (window.__verifyToken === ${JSON.stringify(token)}) return false;
           const r = document.getElementById('root');
           return !!r && Object.keys(r).some(k => k.startsWith('__reactContainer')) && r.innerHTML.length > 0;
         })()`,
      ).catch(() => false);
      if (ready) {
        await sleep(250);
        return true;
      }
    }
    return false;
  }
}

const EMAIL = process.env.VERIFY_EMAIL ?? 'admin@vyuha.local';
const PASSWORD = process.env.VERIFY_PASSWORD ?? '';

/**
 * The app requires a real session now, so the harness has to sign in the way a
 * person does - through the form. Doing it by injecting a token would skip the
 * one path every user takes, and would keep passing after the login screen
 * broke.
 */
async function signIn(s) {
  const onLogin = await s.eval(`!!document.querySelector('#email')`);
  if (!onLogin) return true;

  if (!PASSWORD) {
    console.log('FAIL  Sign in — VERIFY_PASSWORD is not set, and the app now requires a session');
    return false;
  }

  const fill = (sel, value) =>
    s.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  await fill('#email', EMAIL);
  await fill('#password', PASSWORD);
  await s.eval(`document.querySelector('form').requestSubmit(); true`);

  const ok = await s.waitFor(`!!document.querySelector('[data-slot="sidebar"]')`, 15000);
  return Boolean(ok);
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
check('Signs in through the login form', await signIn(s), `as ${EMAIL}`);

// Read from the registry rather than hardcoded.
//
// This assertion used to be `=== 16`. It went stale the moment a screen was
// added, and it was the wrong claim even while it passed: sixteen links is
// also what you get when the wrong sixteen render. Admin holds every
// permission, so the honest statement is that an Admin sees exactly the routes
// nav.ts declares - no more, and none missing.
//
// Parsed rather than imported because nav.ts pulls in icon components and TSX
// that plain node cannot load. A regex over `to: '...'` is enough: the type's
// own `to: string;` has no quotes, so it cannot be mistaken for an entry. Not
// anchored to the line start - Dashboard is written inline as `{ to: '/', ...`
// and an anchored pattern silently dropped it, which is exactly the kind of
// quiet undercount that makes a derived expectation worse than a literal one.
const navSource = readFileSync(new URL('../src/lib/nav.ts', import.meta.url), 'utf8');
const declaredRoutes = [...navSource.matchAll(/\bto: '([^']+)'/g)].map((m) => m[1]).sort();
const renderedRoutes = JSON.parse(
  await s.eval(
    `JSON.stringify([...document.querySelectorAll('[data-slot="sidebar"] a[href]')]
       .map(a => new URL(a.href).pathname).sort())`,
  ),
);
const missing = declaredRoutes.filter((r) => !renderedRoutes.includes(r));
const extra = renderedRoutes.filter((r) => !declaredRoutes.includes(r));
check(
  'Sidebar renders every route nav.ts declares, and nothing else',
  declaredRoutes.length > 0 && missing.length === 0 && extra.length === 0,
  missing.length || extra.length
    ? `missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(extra)}`
    : `${String(declaredRoutes.length)} routes for Admin`,
);

const groups = await s.eval(
  `JSON.stringify([...document.querySelectorAll('[data-slot="sidebar-group-label"]')].map(e => e.textContent.trim()))`,
);
check('Nav groups match PRD 6.1', groups === '["Work","Records","Reports","Setup"]', groups);

// The page name lives in the header breadcrumb and nowhere else. Counting every
// h1 in the document, rather than reading the first one, is what makes this
// fail if a screen ever states its name a second time in the body.
//
// Scoped to #main-content, not 'main': SidebarInset also renders a <main>, and
// that outer one wraps the header — so 'main h1' matches the header's own
// heading and would report a duplicate that does not exist.
const h1Count = await s.eval(`document.querySelectorAll('h1').length`);
check(
  'Page name stated exactly once, in the header breadcrumb',
  h1Count === 1 &&
    (await s.eval(`document.querySelector('header h1')?.textContent`)) === 'Dashboard' &&
    (await s.eval(`document.querySelectorAll('#main-content h1').length`)) === 0,
  `${h1Count} h1 in document, in the header`,
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
//
// These wait on the surface rather than sleeping a fixed 700ms. The sleep was
// long enough almost always, which is the worst kind of probe: it failed
// roughly one run in ten and taught you to rerun until it went green.
const PALETTE = `[data-slot="command-input"], input[cmdk-input]`;
await s.key('KeyG', 'g', 1);
check('Alt+G opens the Go To palette', Boolean(await s.waitFor(`!!document.querySelector('${PALETTE}')`)));
const items = await s.eval(
  `document.querySelectorAll('[cmdk-item], [data-slot="command-item"]').length`,
);
// Same registry, same reason: the palette lists what the sidebar lists
// (REQ-N-01), so it is the declared count that decides, not a literal.
check(
  'Palette offers one entry per navigable route',
  items === declaredRoutes.length,
  `${items} items against ${String(declaredRoutes.length)} declared`,
);

await s.key('Escape', 'Escape');
check(
  'Esc closes the palette',
  Boolean(await s.waitFor(`!document.querySelector('${PALETTE}')`)),
);

// ------------------------------------------ Ctrl+F1 / F1 sheet (REQ-N-04)
await s.key('F1', 'F1');
check(
  'F1 opens the shortcut reference sheet',
  Boolean(await s.waitFor(`document.body.textContent.includes('Keyboard shortcuts')`)),
);
const chips = await s.eval(`document.querySelectorAll('[data-slot="kbd"]').length`);
check('Sheet lists shortcuts as hint chips', chips >= 4, `${chips} kbd chips`);
await s.key('Escape', 'Escape');
await s.waitFor(`!document.body.textContent.includes('Keyboard shortcuts')`);

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
  // Asserts on the component's data-slot, not a Tailwind class string: the
  // class is an implementation detail that changed the moment the row was
  // rebuilt on shadcn's Item, and a probe keyed to it fails for the wrong
  // reason.
  (await s.eval(
    `document.querySelectorAll('[data-slot="item-group"] [data-slot="item"]').length`,
  )) === 4,
  '4 stacked rows built from shadcn Item',
);
check(
  'Stacked rows expose a tap target for the whole row',
  (await s.eval(
    `[...document.querySelectorAll('[role="button"]')]
       .filter(e => e.offsetParent !== null)
       .map(e => e.getBoundingClientRect())
       .filter(r => r.height >= 44).length >= 4`,
  )) === true,
  'the mobile record rows are the tap target, not a link inside them',
);

// CLAUDE.md §3 rule 1: at least 44px on a phone.
//
// The size floor is keyed on `pointer: coarse`, so a viewport override alone
// proves nothing - Chrome still reports a fine pointer at 360px wide and the
// rule never matches.
//
// Emulation.setEmulatedMedia does NOT support pointer/hover features: passing
// them is accepted silently and matchMedia keeps returning false, which is
// exactly the kind of probe that reports a phone as compliant while testing a
// desktop. Chrome derives `pointer: coarse` from touch emulation instead, so
// that is what we turn on, and the assertion below confirms the media query
// actually flipped before trusting any measurement.
await s.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await s.goto('/patterns');

check(
  'Coarse-pointer emulation is actually active',
  (await s.eval(`window.matchMedia('(pointer: coarse)').matches`)) === true,
  'guards the measurement below from passing against a fine pointer',
);

const undersized = await s.eval(
  `JSON.stringify([...document.querySelectorAll('button, a[href], [role="button"], [role="menuitem"]')]
     // sr-only controls (the skip link) are 1px by design until focused.
     .filter(e => e.offsetParent !== null && !e.className.toString().includes('sr-only'))
     .map(e => ({ label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24),
                  h: Math.round(e.getBoundingClientRect().height) }))
     .filter(o => o.h > 0 && o.h < 44))`,
);
const undersizedList = JSON.parse(undersized);
check(
  'All touch targets at least 44px with a coarse pointer',
  undersizedList.length === 0,
  undersizedList.length === 0
    ? 'every control clears the 44px floor'
    : JSON.stringify(undersizedList.slice(0, 4)),
);

// The same controls must stay dense on a desktop pointer - PRD §6.3 asks for a
// compact operations tool, and a 44px floor everywhere would undo that. This
// is the other half of the assertion: without it, "44px everywhere" would also
// pass, and that is a different product.
await s.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
await s.viewport(1440, 900);
await s.goto('/patterns');
check(
  'Fine-pointer emulation is actually active',
  (await s.eval(`window.matchMedia('(pointer: fine)').matches`)) === true,
);
const desktopButtonHeight = await s.eval(
  `Math.round(document.querySelector('[data-slot="button"]').getBoundingClientRect().height)`,
);
check(
  'Desktop stays dense (the 44px floor is coarse-pointer only)',
  desktopButtonHeight > 0 && desktopButtonHeight < 44,
  `${desktopButtonHeight}px button with a fine pointer`,
);
await s.viewport(360, 740);

// ------------------------------------------------------- motion (PRD §6.4)
//
// The keyboard surfaces must open with no motion, and - just as important -
// the exemption must be scoped. A probe that only asserted "palette is 0s"
// would still pass if someone disabled animation across the whole app, which
// is a different and worse product. So both halves are asserted together.
await s.viewport(1440, 900);
await s.goto('/');
await s.key('KeyG', 'g', 1);
await sleep(400);

const paletteMotion = await s.eval(
  `(() => {
     const popup = document.querySelector('[data-slot="dialog-content"]');
     const overlay = document.querySelector('[data-slot="dialog-overlay"]');
     if (!popup || !overlay) return null;
     return JSON.stringify({
       popup: getComputedStyle(popup).animationDuration,
       overlay: getComputedStyle(overlay).animationDuration,
     });
   })()`,
);
check(
  'Go To palette opens with zero motion',
  paletteMotion !== null && JSON.parse(paletteMotion).popup === '0s' &&
    JSON.parse(paletteMotion).overlay === '0s',
  paletteMotion ?? 'palette or overlay not found',
);
await s.key('Escape', 'Escape');
await sleep(400);

// The control: an ordinary Dialog, opened deliberately rather than by reflex,
// keeps its animation. Comparing two Dialogs isolates the exemption itself -
// the only difference between this surface and the palette is the
// surface-instant class, so if this also reported 0s the rule would be global
// and the check above would be meaningless.
//
// Deliberately not the theme dropdown: base-lyra hard-codes animate-none! on
// menus, so that surface can never animate and asserting on it would produce a
// check that fails for a reason unrelated to anything we control.
await s.goto('/patterns');
await s.eval(
  `(() => { const el = document.getElementById('demo-name');
     const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
     set.call(el, 'dirty'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
);
await s.key('KeyQ', 'q', 2); // Ctrl+Q with a dirty form opens the confirm dialog
await sleep(500);
const confirmDuration = await s.eval(
  `(() => { const d = document.querySelector('[data-slot="dialog-content"]');
     return d ? getComputedStyle(d).animationDuration : null; })()`,
);
check(
  'An ordinary dialog keeps its animation (the exemption is scoped)',
  confirmDuration !== null && parseFloat(confirmDuration) > 0,
  `confirm dialog animation-duration ${String(confirmDuration)}`,
);
await s.key('Escape', 'Escape');
await sleep(300);

// NFR-07. prefers-reduced-motion IS a supported emulated feature, unlike
// pointer, so this one can be driven directly.
await s.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
});
await s.goto('/patterns');
// Parsed as a number, not string-compared: Chrome serialises 0.01ms as
// "1e-05s", so an equality check against "0.01ms" fails while the feature
// works perfectly. A probe that reports a working feature as broken costs as
// much trust as one that reports a broken feature as working.
await s.waitFor(`!!document.querySelector('[data-slot="button"]')`);
const reducedDuration = await s.eval(
  `(() => { const b = document.querySelector('[data-slot="button"]');
     return b ? parseFloat(getComputedStyle(b).transitionDuration) : null; })()`,
);
check(
  'Reduced motion is honoured',
  (await s.eval(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`)) === true &&
    reducedDuration !== null &&
    reducedDuration < 0.001,
  `transition-duration ${String(reducedDuration)}s under reduce`,
);
await s.send('Emulation.setEmulatedMedia', { features: [] });

// -------------------------------------------- mobile bottom nav (PRD 6.5)
await s.viewport(360, 740);
await s.goto('/');

const tabs = await s.eval(
  `document.querySelectorAll('nav[aria-label="Primary"] li').length`,
);
check('Bottom nav shows 4 destinations plus More', tabs === 5, `${tabs} tabs`);

check(
  'Bottom nav is phone-only',
  (await s.eval(
    `getComputedStyle(document.querySelector('nav[aria-label="Primary"]')).display`,
  )) !== 'none',
  'visible at 360px',
);

// The bar is position:fixed, so it covers content unless the scroll container
// reserves room. Measuring the gap is the only way to know it actually does.
const clearance = await s.eval(
  `(() => {
     const bar = document.querySelector('nav[aria-label="Primary"]').getBoundingClientRect();
     const main = document.getElementById('main-content');
     const pad = parseFloat(getComputedStyle(main).paddingBottom);
     return Math.round(pad - bar.height);
   })()`,
);
check(
  'Content clears the fixed bar',
  clearance >= 0,
  `${clearance}px of padding beyond the bar height`,
);

await s.viewport(1440, 900);
await s.goto('/');
check(
  'Bottom nav is hidden on desktop',
  (await s.eval(
    `(() => { const n = document.querySelector('nav[aria-label="Primary"]');
       return !n || getComputedStyle(n).display === 'none'; })()`,
  )) === true,
);

// ----------------------------------------------------- sidebar brand
// The brand used to be a hand-padded div beside SidebarMenuButton rows, so its
// mark sat off the icon column. Comparing centres is what catches that;
// comparing that it merely renders would not.
const brandAlignment = await s.eval(
  `(() => {
     const brand = document.querySelector('[data-slot="sidebar-header"] [data-slot="sidebar-menu-button"]');
     const nav = document.querySelector('[data-slot="sidebar-content"] [data-slot="sidebar-menu-button"]');
     if (!brand || !nav) return null;
     const b = brand.getBoundingClientRect(), n = nav.getBoundingClientRect();
     return Math.round(Math.abs(b.left - n.left));
   })()`,
);
check(
  'Sidebar brand aligns with the nav column',
  brandAlignment !== null && brandAlignment <= 1,
  `${String(brandAlignment)}px horizontal offset from the first nav item`,
);

// ------------------------------------------------- shortcut reference
await s.key('F1', 'F1');
await sleep(500);
check(
  'F1 opens the shortcut reference as a centred dialog',
  (await s.eval(
    `!!document.querySelector('[data-slot="dialog-content"]') &&
     !document.querySelector('[data-slot="sheet-content"]') &&
     document.body.textContent.includes('Keyboard shortcuts')`,
  )) === true,
);
await s.key('Escape', 'Escape');
await sleep(300);

// ------------------------------------------------------------ dark mode
// The theme tokens moved wholesale with the preset and had only ever been
// looked at in light. Rendering dark and reading real computed colours is the
// difference between "the class is applied" and "it is legible".
await s.eval(`document.documentElement.classList.add('dark'); true`);
await sleep(400);

function contrastExpr(selector) {
  // Colours are resolved by painting them, not by parsing the string.
  // getComputedStyle now returns the authored colour space - this theme
  // yields `oklch(0.147 0.004 49.25)` and `oklab(... / 0.7)` - so a regex that
  // assumes rgb() reads the lightness and hue as if they were red and green
  // and reports a confident, meaningless ratio. Painting the background and
  // then the foreground over it also composites alpha exactly as the screen
  // does, which a string parse cannot do at all.
  return `(() => {
    const el = ${selector};
    if (!el) return null;
    let node = el, bgCss = null;
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bgCss = c; break; }
      node = node.parentElement;
    }
    if (!bgCss) bgCss = getComputedStyle(document.documentElement).backgroundColor || '#ffffff';

    const cv = document.createElement('canvas');
    cv.width = 2; cv.height = 2;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = bgCss; ctx.fillRect(0, 0, 2, 2);
    const bg = ctx.getImageData(0, 0, 1, 1).data;
    ctx.fillStyle = getComputedStyle(el).color; ctx.fillRect(0, 0, 2, 2);
    const fg = ctx.getImageData(0, 0, 1, 1).data;

    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (d) => 0.2126 * lin(d[0]) + 0.7152 * lin(d[1]) + 0.0722 * lin(d[2]);
    const a = lum(fg), b = lum(bg);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  })()`;
}

const darkBody = await s.eval(contrastExpr(`document.querySelector('header h1')`));
check(
  'Dark mode: page title clears WCAG AA (4.5:1)',
  darkBody !== null && darkBody >= 4.5,
  `${String(darkBody)}:1`,
);

const darkMuted = await s.eval(
  contrastExpr(`document.querySelector('[data-slot="sidebar-group-label"]')`),
);
check(
  'Dark mode: muted sidebar labels clear WCAG AA large-text (3:1)',
  darkMuted !== null && darkMuted >= 3,
  `${String(darkMuted)}:1`,
);

await s.eval(`document.documentElement.classList.remove('dark'); true`);
await sleep(300);
const lightMuted = await s.eval(
  contrastExpr(`document.querySelector('[data-slot="sidebar-group-label"]')`),
);
check(
  'Light mode: muted sidebar labels clear WCAG AA large-text (3:1)',
  lightMuted !== null && lightMuted >= 3,
  `${String(lightMuted)}:1`,
);

// ------------------------------------------------------- focus order
// The skip link only earns its place if it is genuinely the first stop.
await s.eval(`document.activeElement?.blur(); true`);
// rawKeyDown delivers the event but suppresses the browser's default action,
// so focus never actually moves and the probe reads whatever was focused
// before. Tab is only meaningful as a real keyDown.
await s.send('Input.dispatchKeyEvent', {
  type: 'keyDown', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
});
await s.send('Input.dispatchKeyEvent', {
  type: 'keyUp', code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
});
await sleep(250);
const firstStop = await s.eval(
  `(document.activeElement?.textContent ?? '').trim().slice(0, 20)`,
);
check(
  'First Tab stop is the skip link',
  firstStop === 'Skip to content',
  `focus landed on "${String(firstStop)}"`,
);

const focusRing = await s.eval(
  `(() => { const el = document.activeElement; if (!el) return null;
     const cs = getComputedStyle(el);
     return cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' ||
            parseFloat(cs.getPropertyValue('--tw-ring-shadow') ? '1' : '0') === 1; })()`,
);
check('Focused element has a visible focus indicator', focusRing === true);

// ============================================ Employees (REQ-A-03, screen 10)
//
// This screen reads a real endpoint, so the probes below assert on values that
// could only have come from the server - an employee code, a count, a
// dd-MM-yyyy date - rather than on "a table exists". A table of skeletons
// would satisfy the latter.
await s.viewport(1440, 900);
check('Employees route mounts', await s.goto('/employees'));

const employeeRows = await s.waitFor(`document.querySelectorAll('table tbody tr').length`, 12000);
check(
  'Employees renders rows from the API',
  Number(employeeRows) > 0,
  `${String(employeeRows)} rows`,
);

const headers = await s.eval(
  `JSON.stringify([...document.querySelectorAll('table thead th')].map(e => e.textContent.trim()))`,
);
check(
  'Employee columns match the contract',
  headers ===
    '["Code","Employee","Department","Designation","Location","Type","Joined","Status"]',
  headers,
);

// REQ-L-01. Asserting the dd-MM-yyyy shape is not enough on its own: an ISO
// string also contains digits and dashes, so the probe additionally refuses a
// leading four-digit year, which is the exact mistake it exists to catch.
const joined = await s.eval(
  `(() => { const cells = [...document.querySelectorAll('table tbody tr')].map(r => r.children[6]?.textContent.trim());
     return JSON.stringify({ sample: cells[0] ?? null,
       formatted: cells.every(c => /^\\d{2}-\\d{2}-\\d{4}$/.test(c ?? '')),
       anyIso: cells.some(c => /^\\d{4}-/.test(c ?? '')) }); })()`,
);
check(
  'Dates render dd-MM-yyyy, never a raw ISO string',
  JSON.parse(joined).formatted && !JSON.parse(joined).anyIso,
  `first joining date "${String(JSON.parse(joined).sample)}"`,
);

check(
  'Codes and dates use tabular numerals (PRD 6.3)',
  (await s.eval(
    `(() => { const r = document.querySelector('table tbody tr');
       const nums = (el) => getComputedStyle(el).fontVariantNumeric.includes('tabular-nums');
       return nums(r.children[0]) && nums(r.children[6]); })()`,
  )) === true,
);

// The filter has to be in the address bar, not in component state: a filtered
// list that cannot be linked or reloaded is a different feature.
await s.goto('/employees?status=ON_NOTICE');
await s.waitFor(`document.querySelectorAll('table tbody tr').length > 0`, 12000);
const filteredStatuses = await s.eval(
  `JSON.stringify([...document.querySelectorAll('table tbody tr')].map(r => r.lastElementChild.textContent.trim()))`,
);
check(
  'A status filter survives a cold load from the URL',
  filteredStatuses !== '[]' && JSON.parse(filteredStatuses).every((t) => t === 'On notice'),
  `${String(JSON.parse(filteredStatuses).length)} rows, all "On notice"`,
);
check(
  'The chosen filter is reflected in the control, not just the data',
  (await s.eval(
    `document.querySelector('[data-slot="select-trigger"]')?.textContent.includes('On notice')`,
  )) === true,
);

// Empty is a designed state, and it has to be the *right* empty state: the
// no-matches copy offers a way back, the no-records copy would not.
await s.goto('/employees?q=zzzznobodymatchesthis');
await s.waitFor(`!!document.querySelector('[data-slot="empty-title"]')`, 15000);
const emptyState = await s.eval(
  `JSON.stringify({
     title: document.querySelector('[data-slot="empty-title"]')?.textContent ?? null,
     action: !!document.querySelector('[data-slot="empty-content"] button'),
     noTable: !document.querySelector('table'),
     alert: document.querySelector('[data-slot="alert-title"]')?.textContent ?? null,
   })`,
);
const es = JSON.parse(emptyState);
check(
  'A search with no matches shows the empty state, with a way out',
  es.title === 'No matching employees' && es.action && es.noTable,
  emptyState,
);

// -------------------------------------------------- employees: error states
//
// The list is a boundary. Both failures below are ones a person can actually
// reach - a server that is down, and a server that answers with something
// else - and neither may produce a blank screen.
await s.send('Network.enable');
await s.send('Network.setBlockedURLs', { urls: ['*/api/v1/employees*'] });
await s.goto('/employees');
await s.waitFor(`!!document.querySelector('[data-slot="alert"]')`, 15000);
check(
  'A dead server produces a named error, not a blank screen',
  (await s.eval(`document.querySelector('[data-slot="alert-title"]')?.textContent`)) ===
    'Could not reach the server' &&
    (await s.eval(`!!document.querySelector('[data-slot="alert-action"] button')`)) === true,
  'title, description, and a Try again action',
);

await s.send('Network.setBlockedURLs', { urls: [] });
await s.eval(`document.querySelector('[data-slot="alert-action"] button').click(); true`);
const recovered = await s.waitFor(
  `!document.querySelector('[data-slot="alert"]') && document.querySelectorAll('table tbody tr').length > 0`,
  15000,
);
check('Try again actually retries and recovers', Boolean(recovered), 'rows returned after retry');

// A 200 carrying the wrong shape. Without the schema at the boundary this
// crashes inside a cell renderer; the assertion on exceptions is what proves
// the difference between "handled" and "the error state happened to render".
const exceptionsBefore = s.exceptions.length;
await s.eval(`(() => {
  const real = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/v1/employees')) {
      return new Response(JSON.stringify({ items: [{ id: 1 }], total: 3 }), {
        status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return real(input, init);
  };
  return true;
})()`);
await s.eval(
  `history.pushState({}, '', '/employees?q=shapecheck');
   window.dispatchEvent(new PopStateEvent('popstate')); true`,
);
const shapeAlert = await s.waitFor(
  `document.querySelector('[data-slot="alert-description"]')?.textContent.includes('shape this screen cannot read')`,
  15000,
);
check(
  'A response in the wrong shape is refused at the boundary',
  Boolean(shapeAlert) && s.exceptions.length === exceptionsBefore,
  'error state rendered, and nothing was thrown',
);

// --------------------------------------------------- employees: pagination
await s.goto('/employees?pageSize=5');
await s.waitFor(`document.querySelectorAll('table tbody tr').length === 5`, 12000);
check(
  'Pagination reads its page size from the URL',
  (await s.eval(`document.querySelectorAll('table tbody tr').length`)) === 5,
  '5 rows per page',
);
check(
  'The record range is stated',
  (await s.eval(
    `[...document.querySelectorAll('#main-content p')].some(e => /^Records 1–5 of \\d+$/.test(e.textContent.trim()))`,
  )) === true,
);
// PRD §6.4: a registered shortcut without a visible hint is a review failure,
// so the chip is asserted on the control rather than only in the F1 sheet.
const pagerChips = await s.eval(
  `JSON.stringify([...document.querySelectorAll('[data-slot="pagination-link"]')]
     .map(e => ({ label: e.getAttribute('aria-label'),
                  kbd: [...e.querySelectorAll('[data-slot="kbd"]')].map(k => k.textContent).join('') }))
     .filter(o => o.kbd))`,
);
check(
  'Previous and Next carry their Page Up / Page Down hint chips',
  pagerChips === '[{"label":"Previous page","kbd":"PgUp"},{"label":"Next page","kbd":"PgDn"}]',
  pagerChips,
);
check(
  'Page links are real, linkable URLs',
  (await s.eval(`document.querySelector('[aria-label="Page 3"]')?.getAttribute('href')`)) ===
    '/employees?pageSize=5&page=3',
);

const firstCodeBefore = await s.eval(`document.querySelector('table tbody tr td')?.textContent`);
await s.key('PageDown', 'PageDown');
await sleep(900);
const firstCodeAfter = await s.eval(`document.querySelector('table tbody tr td')?.textContent`);
check(
  'Page Down turns the page and the URL follows',
  (await s.eval(`location.search`)) === '?pageSize=5&page=2' &&
    firstCodeAfter !== firstCodeBefore,
  `${String(firstCodeBefore)} -> ${String(firstCodeAfter)}`,
);
await s.key('PageUp', 'PageUp');
await sleep(900);
check(
  'Page Up turns back, and page one drops the parameter',
  (await s.eval(`location.search`)) === '?pageSize=5' &&
    (await s.eval(`document.querySelector('table tbody tr td')?.textContent`)) === firstCodeBefore,
);

// ------------------------------------------------- employees at 360px
await s.viewport(360, 740);
await s.goto('/employees?pageSize=5');
await s.waitFor(`document.querySelectorAll('[data-slot="item-group"] [data-slot="item"]').length > 0`, 12000);
const empOverflow = await s.eval(
  `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
);
check('Employees has no horizontal overflow at 360px', empOverflow <= 0, `${empOverflow}px`);
check(
  'Employees collapses to stacked rows below 768px',
  (await s.eval(
    `(() => { const t = document.querySelector('table'); return !t || t.closest('div').offsetParent === null; })()`,
  )) === true &&
    (await s.eval(
      `document.querySelectorAll('[data-slot="item-group"] [data-slot="item"]').length`,
    )) === 5,
  'PRD 6.5 stacked rows, not a sideways scroll',
);

// ============================================= account menu and profile
await s.viewport(1440, 900);
await s.goto('/employees');
await s.waitFor(`!!document.querySelector('[aria-label^="Account menu"]')`);
check(
  'The header names the signed-in person',
  (await s.eval(`document.querySelector('[aria-label^="Account menu"]')?.getAttribute('aria-label')`))
    ?.includes(EMAIL) === true,
  `accessible name carries ${EMAIL}`,
);

await s.eval(`document.querySelector('[aria-label^="Account menu"]').click(); true`);
await s.waitFor(`!!document.querySelector('[data-slot="dropdown-menu-content"]')`);
const menuText = await s.eval(
  `document.querySelector('[data-slot="dropdown-menu-content"]')?.textContent ?? ''`,
);
check(
  'The account menu states the email and role, and offers Profile and Sign out',
  menuText.includes(EMAIL) &&
    menuText.includes('Admin') &&
    menuText.includes('Profile') &&
    menuText.includes('Sign out'),
  'identity plus both actions',
);
await s.key('Escape', 'Escape');
await sleep(300);

// CLAUDE.md §3.1: on a phone this opens as a bottom Sheet, not a corner
// popover. Asserting the Sheet *and* the absence of the dropdown is what makes
// this fail if the desktop surface is ever reused on a phone.
//
// Touch emulation is on for this section, and it is not decoration. The 44px
// floor is keyed on `pointer: coarse`, so measuring sizes at 360px with a mouse
// attached reports 32px controls as a violation when they are the correct
// desktop density - a probe that manufactures its own failure.
await s.viewport(360, 740);
await s.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await s.goto('/employees');
check(
  'Coarse pointer is active for the phone measurements below',
  (await s.eval(`window.matchMedia('(pointer: coarse)').matches`)) === true,
);
await s.waitFor(`!!document.querySelector('[aria-label^="Account menu"]')`);
await s.eval(`document.querySelector('[aria-label^="Account menu"]').click(); true`);
await s.waitFor(`!!document.querySelector('[data-slot="sheet-content"]')`);
const sheetBox = await s.eval(
  `(() => { const el = document.querySelector('[data-slot="sheet-content"]'); if (!el) return null;
     const r = el.getBoundingClientRect();
     return JSON.stringify({ full: Math.round(r.width) === window.innerWidth,
                             bottom: Math.round(r.bottom) === window.innerHeight,
                             text: el.textContent }); })()`,
);
check(
  'On a phone the account menu is a bottom Sheet, not a popover',
  sheetBox !== null &&
    JSON.parse(sheetBox).full &&
    JSON.parse(sheetBox).bottom &&
    JSON.parse(sheetBox).text.includes('Sign out') &&
    (await s.eval(`!document.querySelector('[data-slot="dropdown-menu-content"]')`)) === true,
  'full width, flush to the bottom edge, and it carries Sign out',
);
const sheetSmall = await s.eval(
  `JSON.stringify([...document.querySelectorAll('[data-slot="sheet-content"] button')]
     .filter(e => e.offsetParent !== null)
     .map(e => ({ t: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16),
                  h: Math.round(e.getBoundingClientRect().height) }))
     .filter(o => o.h < 44))`,
);
check(
  'Every control in the account sheet clears 44px on a touch device',
  sheetSmall === '[]',
  sheetSmall === '[]' ? 'all at least 44px' : sheetSmall,
);
await s.key('Escape', 'Escape');
await sleep(300);
await s.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });

await s.viewport(1440, 900);
check('Profile route mounts', await s.goto('/profile'));
await s.waitFor(`document.querySelectorAll('[data-slot="item-group"] [data-slot="item"]').length > 0`);
const profile = await s.eval(
  `JSON.stringify({
     heading: document.querySelector('header h1')?.textContent,
     email: document.body.textContent.includes(${JSON.stringify(EMAIL)}),
     roles: [...document.querySelectorAll('[data-slot="badge"]')].map(e => e.textContent.trim()),
     permissions: document.querySelectorAll('[data-slot="item-group"] [data-slot="item"]').length,
     firstKey: document.querySelector('[data-slot="item-title"]')?.textContent,
   })`,
);
const p = JSON.parse(profile);
check(
  'Profile shows the identity, roles and the effective permission set',
  p.heading === 'Profile' &&
    p.email &&
    p.roles.includes('Admin') &&
    p.permissions === 22 &&
    /^[a-z]+\./.test(p.firstKey ?? ''),
  `${String(p.permissions)} permissions, roles ${JSON.stringify(p.roles)}`,
);
check(
  'Profile has no horizontal overflow at 360px',
  await (async () => {
    await s.viewport(360, 740);
    await s.goto('/profile');
    await s.waitFor(`!!document.querySelector('[data-slot="item-group"]')`);
    const o = await s.eval(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    await s.viewport(1440, 900);
    return o <= 0;
  })(),
);

// ------------------------------------------------------------ console
check('No console errors', s.consoleErrors.length === 0, s.consoleErrors.slice(0, 2).join(' | ') || 'clean');
check('No uncaught exceptions', s.exceptions.length === 0, s.exceptions.slice(0, 2).join(' | ') || 'clean');

// ------------------------------------------------------------- sign out
//
// Last, and deliberately after the console assertions. Signing out revokes the
// refresh cookie, so the next `/auth/refresh` answers 401 - which the browser
// logs. That 401 is the app correctly discovering it has no session, not a
// fault, and folding it into the console check would make this suite fail for
// doing the right thing.
//
// Back to a desktop viewport first. The preceding checks leave the browser at
// 360px, where the account control is a bottom Sheet rather than a dropdown -
// so the dropdown selector below found nothing and `.click()` threw on
// undefined, failing the last check for a reason that had nothing to do with
// signing out. A sequence that depends on a viewport has to set it.
await s.viewport(1440, 900);
await s.goto('/');
await s.waitFor(`!!document.querySelector('[aria-label^="Account menu"]')`);
await s.eval(`document.querySelector('[aria-label^="Account menu"]').click(); true`);
await s.waitFor(`!!document.querySelector('[data-slot="dropdown-menu-content"]')`);
await s.eval(
  `[...document.querySelectorAll('[data-slot="dropdown-menu-item"]')]
     .find(e => e.textContent.trim() === 'Sign out').click(); true`,
);
const signedOut = await s.waitFor(
  `!!document.querySelector('#email') && !document.querySelector('[data-slot="sidebar"]')`,
  12000,
);
check('Sign out returns to the sign-in screen', Boolean(signedOut));

// The real test of a sign out is that it does not come back. A reload that
// still finds a session would mean only the client forgot.
await s.goto('/employees');
check(
  'The session does not survive a reload after sign out',
  Boolean(await s.waitFor(`!!document.querySelector('#email')`, 12000)) &&
    (await s.eval(`document.querySelectorAll('table tbody tr').length`)) === 0,
  'still anonymous, and no employee data on screen',
);

check('Signing back in works', await signIn(s), `as ${EMAIL}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILURES:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);
