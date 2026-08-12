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
    env: { LOG_LEVEL: 'silent', JOBS_WORKER_ENABLED: 'false' },
  },
});
