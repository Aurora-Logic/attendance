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
