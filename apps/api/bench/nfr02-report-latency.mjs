/**
 * NFR-02: "Any report renders its first page in under 1.5 seconds at 500
 * employees x 24 months of data. Seed a dataset of this size and benchmark
 * against it."
 *
 * This is the benchmark that requirement asks for and that has never been run.
 * It measures the API, not the browser: the requirement is about the report
 * answering, and putting Chrome in the loop would fold React's render time into
 * a number meant to describe the server.
 *
 * Each report is called five times. The first call is reported separately --
 * a cold cache and a first plan are what a person hitting a report at 9am
 * actually experiences, and an average that hides it would flatter the result.
 */
const BASE = 'http://localhost:3000/api/v1';
const LIMIT_MS = 1500;
const RUNS = 5;

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'bench@vyuha.test', password: 'password' }),
});
const { accessToken } = await login.json();
if (!accessToken) {
  console.error('sign-in failed');
  process.exit(2);
}
const auth = { Authorization: `Bearer ${accessToken}` };

const catalogue = await (await fetch(`${BASE}/reports`, { headers: auth })).json();
const reports = (catalogue.data ?? catalogue).map((r) => r.key);
console.log(`${reports.length} reports, 500 employees x 24 months\n`);

/** A month, which is the period a report opens on. */
const MONTH = { from: '2026-08-01', to: '2026-08-31' };
/** And the full two years, which is the worst case somebody can ask for. */
const FULL = { from: '2024-09-01', to: '2026-08-31' };

async function timeOne(reportKey, period, extra = '') {
  const url = `${BASE}/reports/${reportKey}/rows?from=${period.from}&to=${period.to}&pageSize=50${extra}`;
  const timings = [];
  let total = null;
  let status = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const started = process.hrtime.bigint();
    const response = await fetch(url, { headers: auth });
    const body = await response.json();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    timings.push(ms);
    status = response.status;
    total = body?.meta?.total ?? total;
  }
  return {
    first: timings[0],
    median: [...timings].sort((a, b) => a - b)[Math.floor(RUNS / 2)],
    worst: Math.max(...timings),
    total,
    status,
  };
}

/*
 * A 400 is not always a failure to measure.
 *
 * `monthly-muster` declares `singleMonth` and refuses a period spanning more
 * than one, by design -- a grid whose columns are days cannot show two months
 * side by side. Counting that refusal as a benchmark error made the run report
 * a problem that does not exist, which is worse than reporting nothing.
 */
const REFUSES_LONG_PERIOD = new Set(['monthly-muster']);

function line(label, r, longPeriod = false) {
  const refusedByDesign = r.status === 400 && longPeriod && REFUSES_LONG_PERIOD.has(label);
  const verdict = refusedByDesign
    ? 'N/A'
    : r.status !== 200
      ? 'ERROR'
      : r.worst <= LIMIT_MS
        ? 'PASS'
        : 'FAIL';
  console.log(
    `${verdict.padEnd(6)} ${label.padEnd(30)} first ${r.first.toFixed(0).padStart(6)}ms  ` +
      `median ${r.median.toFixed(0).padStart(6)}ms  worst ${r.worst.toFixed(0).padStart(6)}ms  ` +
      `rows ${String(r.total ?? (refusedByDesign ? 'refused' : '?')).padStart(8)}`,
  );
  return verdict;
}

const failures = [];

console.log('--- one month (the period a report opens on) ---');
for (const key of reports) {
  const r = await timeOne(key, MONTH);
  if (line(key, r) !== 'PASS') failures.push(`${key} (month)`);
}

console.log('\n--- twenty-four months (the widest a filter allows) ---');
for (const key of reports) {
  const r = await timeOne(key, FULL);
  const verdict = line(key, r, true);
  if (verdict !== 'PASS' && verdict !== 'N/A') failures.push(`${key} (24 months)`);
}

console.log(`\nNFR-02 limit ${LIMIT_MS}ms on the worst of ${RUNS} runs.`);
console.log(failures.length === 0 ? 'All reports within the limit.' : `OVER THE LIMIT: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
