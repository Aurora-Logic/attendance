import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants.js';

import { ROUTE_POLICY_KEY, type RoutePolicy } from './route-policy.js';

/**
 * `AccessGuard` already denies a route that declares no policy. This turns the
 * same mistake into a refusal to start.
 *
 * The difference matters. A denied route fails at the moment a user hits it,
 * which for an endpoint added late in a release could be days after the
 * deploy, and the symptom -- 403 -- reads as a permissions question rather
 * than a missing decorator. Discovering it at boot means the mistake is found
 * by whoever made it, before anything is serving.
 *
 * CLAUDE.md: "When a bug represents a category rather than an instance, add
 * the thing that catches the next one." The category here is "a new endpoint
 * whose author did not think about who may call it".
 */
@Injectable()
export class RoutePolicyAudit implements OnApplicationBootstrap {
  private readonly logger = new Logger(RoutePolicyAudit.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const { routes, offenders } = this.inspect();

    if (offenders.length > 0) {
      throw new Error(
        [
          `${String(offenders.length)} route handler(s) declare no access policy:`,
          ...offenders.map((name) => `  ${name}`),
          '',
          'Every route must carry exactly one of @Public(), @Authenticated(), or',
          '@RequirePermission(...). AccessGuard denies an unannotated route, so this',
          'would be a 403 nobody can explain rather than an endpoint that works.',
        ].join('\n'),
      );
    }

    this.logger.log({ msg: `Access policy present on all ${String(routes)} routes.`, routes });
  }

  private inspect(): { routes: number; offenders: string[] } {
    const offenders: string[] = [];
    let routes = 0;

    for (const wrapper of this.discovery.getControllers()) {
      const instance: unknown = wrapper.instance;
      const metatype = wrapper.metatype;
      if (instance === null || typeof instance !== 'object' || typeof metatype !== 'function') {
        continue;
      }

      // `getPrototypeOf` is typed as returning `any`; the object it is given
      // is already narrowed above, so the result is an object or null.
      const prototype = Object.getPrototypeOf(instance) as object | null;
      if (prototype === null) continue;

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const handler: unknown = (prototype as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;
        // Nest stamps PATH_METADATA on a method only when it is a route.
        // Everything else on the controller is a private helper.
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;

        routes += 1;
        const policy = this.reflector.getAllAndOverride<RoutePolicy | undefined>(
          ROUTE_POLICY_KEY,
          [handler, metatype],
        );
        if (policy === undefined) offenders.push(`${metatype.name}.${methodName}`);
      }
    }

    return { routes, offenders };
  }
}
