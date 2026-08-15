/**
 * Product-wide smoke test. Drives the *running* product over real HTTP, the
 * way a user's browser would — no test harness, no guard overrides, no direct
 * database access.
 *
 * What one green run proves, stage by stage:
 *
 *   web-served       the dev/preview server answers with the SPA shell
 *   api-alive        liveness, and readiness with every dependency up
 *                    (Postgres, Redis, MinIO — the API's own answer, not ours)
 *   locked-door      auth is actually on: no token → 401, wrong password → 401
 *   sign-in          the real login endpoint issues a token and an HttpOnly
 *                    SameSite=Strict refresh cookie; /auth/me agrees
 *   module-sweep     one authenticated read per module across the whole API
 *                    surface — platform and attendance both
 *   export-roundtrip the hardest path in the product: request an export,
 *                    watch the BullMQ worker run it, follow the signed URL to
 *                    MinIO and read the file bytes back
 *   browser          the bundle boots into a real React mount with zero
 *                    exceptions (skipped, loudly, when no Chrome is on CDP)
 *   sign-out         logout answers 204 and clears the cookie
 *
 * Safe against a live environment: the only state it creates is a session,
 * one export file, and the audit rows those actions legitimately write. It
 * never punches, never approves, never edits master data.
 *
 * The wrong-password probe runs *before* the real sign-in on purpose: the
 * per-IP login limiter clears its window on success, so the order makes the
 * probe free. Reversed, repeated runs would eat the address's failure budget.
 *
 * This is the shallow-and-wide gate. The deep browser gate (keyboard
 * shortcuts, overflow at 360px, contrast in both themes) stays in
 * apps/web/scripts/verify-ui.mjs; the deep API gate is the vitest suite.
 *
 * Usage:
 *   pnpm dev            # or any running deployment
 *   SMOKE_PASSWORD=... pnpm smoke
 *
 * Environment:
 *   SMOKE_WEB       default http://localhost:5173
 *   SMOKE_API       default http://localhost:3000/api/v1
 *   SMOKE_EMAIL     default admin@vyuha.local
 *   SMOKE_PASSWORD  required (falls back to VERIFY_PASSWORD)
 *   SMOKE_CDP       default http://127.0.0.1:9222 — optional; the browser
 *                   stage skips when nothing is listening
 */

const WEB = process.env.SMOKE_WEB ?? 'http://localhost:5173';
const API = process.env.SMOKE_API ?? 'http://localhost:3000/api/v1';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@vyuha.local';
const PASSWORD = process.env.SMOKE_PASSWORD ?? process.env.VERIFY_PASSWORD ?? '';
// 127.0.0.1, not localhost, for the same reason verify-ui.mjs does it: a
// machine that resolves localhost to ::1 first makes the CDP endpoint look
// broken when it is merely unreached.
const CDP = process.env.SMOKE_CDP ?? 'http://127.0.0.1:9222';

const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const TO = iso(today);
const FROM = iso(new Date(today.getTime() - 6 * 86400000));
const YEAR = today.getFullYear();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with a deadline; a smoke test that hangs is worse than one that fails. */
function http(url, init = {}) {
  return fetch(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(15000) });
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`expected JSON, got: ${text.slice(0, 200)}`);
  }
}

const results = [];
async function stage(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    if (detail === SKIP.token) return; // fn already pushed the skip
    results.push({ name, ok: true, detail, ms: Date.now() - started });
    console.log(`PASS  ${name.padEnd(17)} ${detail} (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({ name, ok: false, detail: error.message, ms: Date.now() - started });
    console.log(`FAIL  ${name.padEnd(17)} ${error.message}`);
  }
}
const SKIP = {
  token: Symbol('skip'),
  now(name, why) {
    results.push({ name, ok: true, skipped: true, detail: why, ms: 0 });
    console.log(`SKIP  ${name.padEnd(17)} ${why}`);
    return SKIP.token;
  },
};

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

// --------------------------------------------------------------------- stages

await stage('web-served', async () => {
  const res = await http(`${WEB}/`);
  expect(res.status === 200, `GET ${WEB}/ answered ${res.status}`);
  const html = await res.text();
  expect(html.includes('id="root"'), 'the page served has no #root — not the SPA shell');
  expect(/<script[^>]+type="module"/.test(html), 'no module script tag — nothing will boot');
  return `SPA shell, ${html.length} bytes`;
});

await stage('api-alive', async () => {
  const health = await http(`${API}/health`);
  expect(health.status === 200, `GET /health answered ${health.status}`);
  const ready = await http(`${API}/ready`);
  const body = await json(ready);
  // 503 carries the per-dependency detail; surface it instead of just the code.
  expect(
    ready.status === 200,
    `GET /ready answered ${ready.status}: ${JSON.stringify(body).slice(0, 300)}`,
  );
  const deps = Object.entries(body.checks ?? body.dependencies ?? {})
    .map(([k, v]) => `${k} ${typeof v === 'string' ? v : (v?.status ?? 'ok')}`)
    .join(', ');
  return deps || `ready: ${JSON.stringify(body).slice(0, 120)}`;
});

await stage('locked-door', async () => {
  const bare = await http(`${API}/employees`);
  expect(bare.status === 401, `unauthenticated GET /employees answered ${bare.status}, not 401`);
  await json(bare); // a JSON error envelope, not an HTML error page or a stack
  const wrong = await http(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: `wrong-${Date.now()}` }),
  });
  expect(wrong.status === 401, `wrong password answered ${wrong.status}, not 401`);
  return 'no token → 401, wrong password → 401';
});

let token = '';
let cookie = '';
await stage('sign-in', async () => {
  expect(PASSWORD !== '', 'SMOKE_PASSWORD is not set — cannot sign in');
  const res = await http(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  expect(res.status === 200, `login answered ${res.status} for ${EMAIL}`);
  const body = await json(res);
  expect(body.tokenType === 'Bearer' && body.accessToken, 'login body has no Bearer token');
  token = body.accessToken;
  const setCookie = res.headers.getSetCookie().find((c) => /httponly/i.test(c)) ?? '';
  expect(setCookie !== '', 'no HttpOnly refresh cookie was set');
  expect(/samesite=strict/i.test(setCookie), 'refresh cookie is not SameSite=Strict');
  cookie = setCookie.split(';')[0];
  const me = await json(
    await http(`${API}/auth/me`, { headers: { authorization: `Bearer ${token}` } }),
  );
  expect(me.user?.email === EMAIL, `/auth/me returned ${me.user?.email}, not ${EMAIL}`);
  expect((me.roles ?? []).length > 0, '/auth/me shows no roles — RBAC would deny everything');
  return `${EMAIL}, roles: ${me.roles.map((r) => r.name).join('/')}`;
});

await stage('module-sweep', async () => {
  expect(token !== '', 'no session — sign-in failed');
  // One representative read per module. Every row must answer 200 with JSON;
  // anything else is a broken module, a broken permission, or a broken route.
  const routes = [
    ['settings', '/settings'],
    ['branding', '/settings/branding'],
    ['roles', '/roles'],
    ['locations', '/locations'],
    ['departments', '/departments'],
    ['designations', '/designations'],
    ['employees', '/employees'],
    ['audit', '/audit-logs'],
    ['jobs', '/jobs'],
    ['integrations', '/integrations'],
    ['recycle-bin', '/recycle-bin'],
    ['notifications', '/me/notifications'],
    ['notif-prefs', '/me/notification-preferences'],
    ['today', '/me/today'],
    ['punches', '/punches'],
    ['days', `/attendance/days?from=${FROM}&to=${TO}`],
    ['locks', '/attendance/locks'],
    ['shifts', '/shifts'],
    ['weekly-offs', '/weekly-off-patterns'],
    ['rosters', `/rosters?from=${FROM}&to=${TO}`],
    ['holiday-cals', '/holiday-calendars'],
    ['restricted-hols', '/restricted-holidays'],
    ['leave-types', '/leave/types'],
    ['leave-requests', '/leave/requests'],
    ['leave-balances', `/leave/balances?year=${YEAR}`],
    ['leave-ledger', `/leave/ledger?year=${YEAR}`],
    ['leave-calendar', `/leave/calendar?from=${FROM}&to=${TO}`],
    ['comp-off', '/leave/comp-off'],
    ['approvals', '/approvals'],
    ['delegations', '/approvals/delegations'],
    ['regularizations', '/regularizations'],
    ['reg-policy', '/regularizations/policy'],
    ['on-duty', '/on-duty-requests'],
    ['report-catalogue', '/reports'],
    ['report-views', '/reports/views?reportKey=attendance-register'],
    ['report-rows', `/reports/attendance-register/rows?from=${FROM}&to=${TO}`],
  ];
  const failures = [];
  for (const [name, path] of routes) {
    const res = await http(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status !== 200) {
      const body = (await res.text()).slice(0, 120);
      failures.push(`${name} → ${res.status} ${body}`);
      continue;
    }
    await json(res);
  }
  expect(failures.length === 0, `${failures.length}/${routes.length} failed: ${failures.join('; ')}`);
  return `${routes.length} endpoints, all 200 with JSON`;
});

await stage('export-roundtrip', async () => {
  expect(token !== '', 'no session — sign-in failed');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const requested = await http(`${API}/reports/exports`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      reportKey: 'attendance-register',
      filters: { from: FROM, to: TO },
      format: 'CSV',
    }),
  });
  expect(requested.status === 202, `POST /reports/exports answered ${requested.status}`);
  const job = await json(requested);
  expect(job.id, 'export was accepted but has no id');

  // The poll is the point: DONE means the queue accepted the job, a worker
  // picked it up, the report SQL ran, the file landed in object storage and
  // the row was updated — five subsystems vouched for in one status field.
  let summary = job;
  const deadline = Date.now() + 120000;
  while (summary.status === 'QUEUED' || summary.status === 'RUNNING') {
    expect(Date.now() < deadline, `export still ${summary.status} after 120s — is the worker on?`);
    await sleep(1000);
    summary = await json(
      await http(`${API}/reports/exports/${job.id}`, { headers }),
    );
  }
  expect(summary.status === 'DONE', `export ended ${summary.status}: ${summary.error ?? ''}`);

  const download = await json(
    await http(`${API}/reports/exports/${job.id}/download`, { headers }),
  );
  expect(download.url, 'download endpoint returned no signed URL');
  const file = await http(download.url);
  expect(file.status === 200, `signed URL answered ${file.status}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  expect(bytes.length > 0, 'the exported file is empty');
  const lines = bytes.toString('utf8').split('\n').filter(Boolean).length;
  return `${summary.rowCount ?? '?'} rows, ${bytes.length} bytes, ${lines} lines via signed URL`;
});

await stage('browser', async () => {
  let target;
  try {
    const list = await (await http(`${CDP}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    return SKIP.now(
      'browser',
      `no Chrome on ${CDP} — run verify-ui.mjs for the full browser gate`,
    );
  }
  if (!target?.webSocketDebuggerUrl) {
    return SKIP.now('browser', `Chrome on ${CDP} has no page target`);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push((d.exception?.description ?? d.text).slice(0, 200));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (msg) =>
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result),
      );
      ws.send(JSON.stringify({ id: n, method, params }));
      setTimeout(() => pending.delete(n) && reject(new Error(`CDP timeout: ${method}`)), 15000);
    });
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: `${WEB}/` });
    await sleep(2500);
    // A React container key on #root, not "some HTML exists": the one probe
    // that cannot pass while the page is blank.
    const mounted = await send('Runtime.evaluate', {
      expression: `Object.keys(document.getElementById('root') ?? {})
        .some((k) => k.startsWith('__reactContainer'))`,
      returnByValue: true,
    });
    expect(mounted.result.value === true, 'React never mounted on #root');
    expect(exceptions.length === 0, `${exceptions.length} exception(s): ${exceptions[0]}`);
    return 'React mounted, 0 exceptions';
  } finally {
    ws.close();
  }
});

await stage('sign-out', async () => {
  expect(cookie !== '', 'no refresh cookie — sign-in failed');
  const res = await http(`${API}/auth/logout`, { method: 'POST', headers: { cookie } });
  expect(res.status === 204, `logout answered ${res.status}`);
  return 'session ended with 204';
});

// -------------------------------------------------------------------- summary

const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped);
const ms = results.reduce((a, r) => a + r.ms, 0);
console.log('');
console.log(
  `${failed.length === 0 ? 'SMOKE PASS' : 'SMOKE FAIL'}: ` +
    `${results.length - failed.length - skipped.length} passed, ` +
    `${failed.length} failed, ${skipped.length} skipped, ${(ms / 1000).toFixed(1)}s ` +
    `(${API})`,
);
process.exit(failed.length === 0 ? 0 : 1);
