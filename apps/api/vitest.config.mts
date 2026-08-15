import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'seed/**/*.test.ts'],
    // The integration suite writes to the shared development database. Running
    // files concurrently would let one file's cleanup delete rows another file
    // is still asserting on, which fails intermittently and looks like a bug in
    // the repository rather than in the test setup.
    //
    // This protects files within one run and cannot protect a run from another
    // run. Each file pins its own org id as a constant -- `org-ids.test.ts`
    // enforces that they are distinct -- so two `vitest` processes started at
    // once execute the *same* file against the *same* org, and each one's
    // `beforeAll` reset deletes rows the other is mid-assertion on. Reproduced:
    // two concurrent runs of the same pair of job files failed four accrual and
    // carry-forward tests in one run ("expected undefined to be 1") and passed
    // clean in the other; the same pair, split so neither run touched the other's
    // file, passed both sides three times over.
    //
    // So: do not run this suite twice at once. It cost two separate
    // investigations, both of which first suspected the BullMQ queue prefix
    // below -- which is a real hazard for the developer's own API, and not this
    // one. Splitting the work by file is safe; running the same file twice is
    // not, and no prefix or lock in this config can make it so.
    fileParallelism: false,
    // The integration tests boot the real application, which logs every
    // request through pino. Set before any module loads, so `env.ts` picks it
    // up: `process.loadEnvFile` does not overwrite a variable already present.
    // A failing test's own output is worth more than 200 request lines.
    // Every test file boots the real AppModule. Consuming the BullMQ queues in
    // all of them would mean sixteen sets of workers competing for the same
    // jobs, and a job enqueued by one file being executed by another. The jobs
    // suite starts the workers itself, through the same `JobRunner.startWorkers`
    // the bootstrap hook calls, so nothing about the runner goes untested.
    //
    // The prefix is what keeps the suite out of the developer's own API. That
    // process consumes the same queue names on the same Redis, and it won it
    // often enough that the failure-path test - which mocks the handler's
    // dependency to make the job fail - watched a job complete instead,
    // because the API's unmocked worker had run it. Nothing in the test could
    // see that; it just reported "expected failed, got completed".
    env: { LOG_LEVEL: 'silent', JOBS_WORKER_ENABLED: 'false', JOBS_QUEUE_PREFIX: 'vyuha-test' },
  },
});
