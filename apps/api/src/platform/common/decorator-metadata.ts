import { Injectable } from '@nestjs/common';

/**
 * Nest resolves a constructor dependency from the `design:paramtypes` metadata
 * that TypeScript emits under `emitDecoratorMetadata`. esbuild-based runners --
 * `tsx`, plain `vite-node`, `bun` -- do not emit it, and the resulting failure
 * is silent in the worst way: the process starts, every route maps, the log
 * says "Nest application successfully started", and then every request 500s
 * with "Cannot read properties of undefined".
 *
 * That was observed, not imagined: `tsx src/main.ts` boots this application and
 * serves nothing but 500s. Rather than sprinkle `@Inject()` on every parameter
 * to work around it -- which the next ordinary Nest constructor would undo --
 * the condition is checked once at boot and the process refuses to run.
 *
 * The sanctioned runners are `nest start` (dev) and `node dist/main.js` after
 * `nest build`, both of which compile with tsc. `tsx` stays for scripts with no
 * dependency injection, such as `db:migrate`.
 */

class MetadataProbeDependency {}

@Injectable()
class MetadataProbe {
  constructor(_dependency: MetadataProbeDependency) {}
}

export function assertDecoratorMetadataIsEmitted(): void {
  const paramtypes: unknown = Reflect.getMetadata('design:paramtypes', MetadataProbe);

  if (Array.isArray(paramtypes) && paramtypes.length === 1) return;

  throw new Error(
    [
      'This runtime is not emitting decorator metadata, so Nest cannot resolve',
      'constructor dependencies and every endpoint would answer 500.',
      '',
      'Run the API with "pnpm dev" (nest start --watch) or "pnpm build && pnpm start".',
      'esbuild-based runners such as tsx ignore emitDecoratorMetadata.',
    ].join('\n'),
  );
}
