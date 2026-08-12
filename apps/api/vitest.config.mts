import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'seed/**/*.test.ts'],
    // The integration suite writes to the shared development database. Running
    // files concurrently would let one file's cleanup delete rows another file
    // is still asserting on, which fails intermittently and looks like a bug in
    // the repository rather than in the test setup.
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
