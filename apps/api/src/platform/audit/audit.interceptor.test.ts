import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Post,
  type INestApplication,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test as TestingModule } from '@nestjs/testing';
import { uuidv7 } from '@vyuha/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppExceptionFilter } from '../common/app-exception.filter.js';
import { WILDCARD_ROUTE } from '../common/constants.js';
import { env } from '../common/env.js';
import { AppError } from '../common/errors.js';
import { RequestIdMiddleware } from '../common/request-id.middleware.js';
import { DbModule } from '../db/db.module.js';
import { DRIZZLE, type Database } from '../db/db.provider.js';
import { organizations } from '../db/schema/index.js';
import { AuditContext } from './audit-context.js';
import { AuditContextMiddleware } from './audit-context.middleware.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditModule } from './audit.module.js';

/**
 * "It must not require call sites to remember it."
 *
 * The auth services all enrich their audit rows, so the endpoint tests only
 * ever exercise the enriched path. This file exercises the *unenriched* one:
 * a controller that says nothing at all to `AuditContext` and still leaves a
 * row naming the route, the entity, the id it returned, and the request id.
 *
 * The controller below is a probe rather than a production route -- which is
 * why it is defined here and not in `src/` -- but everything around it is
 * real: the middleware that opens the context, the interceptor, the service,
 * and the append-only table.
 */

const ORG_ID = '01900000-0000-7000-8000-0000000000b3';

interface Created {
  id: string;
  name: string;
}

@Controller('probe-widgets')
class ProbeController {
  constructor(private readonly audit: AuditContext) {}

  /** Says nothing to the audit context. The row must appear anyway. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: { name?: string }): Created {
    this.audit.attribute(ORG_ID, null);
    return { id: uuidv7(), name: body.name ?? 'unnamed' };
  }

  /** Enriches, so the recorded action and diff override the defaults. */
  @Post('renamed')
  @HttpCode(HttpStatus.OK)
  rename(): Created {
    const id = uuidv7();
    this.audit.record({
      orgId: ORG_ID,
      action: 'widget.renamed',
      entityType: 'widget',
      entityId: id,
      before: { name: 'old', colour: 'blue' },
      after: { name: 'new', colour: 'blue' },
    });
    return { id, name: 'new' };
  }

  /** Reads must not be audited. */
  @Get()
  list(): { data: [] } {
    this.audit.attribute(ORG_ID, null);
    return { data: [] };
  }

  /** A refused mutation changed nothing, so it must leave no row. */
  @Delete()
  remove(): never {
    this.audit.attribute(ORG_ID, null);
    throw AppError.conflict('Refused on purpose.');
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  bulk(): { count: number } {
    for (let i = 0; i < 3; i += 1) {
      this.audit.record({
        orgId: ORG_ID,
        action: 'widget.bulk_updated',
        entityType: 'widget',
        entityId: uuidv7(),
      });
    }
    return { count: 3 };
  }
}

@Module({
  imports: [DbModule, AuditModule],
  controllers: [ProbeController],
  providers: [
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, AuditContextMiddleware).forRoutes(WILDCARD_ROUTE);
  }
}

let app: INestApplication;
let baseUrl: string;
let db: Database;

interface AuditRow extends Record<string, unknown> {
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

async function rowsFor(entityId: string): Promise<AuditRow[]> {
  const result = await db.execute<AuditRow>(
    sql`SELECT action, entity_type, entity_id, request_id, ip, user_agent, before, after
          FROM audit_logs WHERE org_id = ${ORG_ID} AND entity_id = ${entityId}`,
  );
  return result.rows;
}

async function countAll(): Promise<number> {
  const result = await db.execute<{ count: string }>(
    sql`SELECT count(*) AS count FROM audit_logs WHERE org_id = ${ORG_ID}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

beforeAll(async () => {
  expect(new URL(env.DATABASE_URL).port).toBe('55432');

  const moduleRef = await TestingModule.createTestingModule({ imports: [ProbeModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0);
  baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  db = app.get<Database>(DRIZZLE);

  await db
    .insert(organizations)
    .values({ id: ORG_ID, name: 'Audit Interceptor Fixture' })
    .onConflictDoUpdate({ target: organizations.id, set: { deletedAt: null } });
}, 30_000);

afterAll(async () => {
  await app.close();
});

/** The audit write is deliberately not awaited by the response. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 120));
}

describe('AuditInterceptor writes without being asked', () => {
  it('records a mutation from a controller that says nothing about auditing', async () => {
    const response = await fetch(`${baseUrl}/probe-widgets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'probe-agent/1.0' },
      body: JSON.stringify({ name: 'Widget' }),
    });
    expect(response.status).toBe(201);

    const created = (await response.json()) as Created;
    await settle();

    const rows = await rowsFor(created.id);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // Route pattern, not the URL, and derived without the handler's help.
    expect(row?.action).toBe('POST probe-widgets');
    expect(row?.entity_type).toBe('probe-widgets');
    // Picked up from the response body.
    expect(row?.entity_id).toBe(created.id);
    expect(row?.request_id).toBeTruthy();
    expect(row?.ip).toBeTruthy();
    expect(row?.user_agent).toBe('probe-agent/1.0');
  });

  it('lets a service override the action and store a narrowed diff', async () => {
    const response = await fetch(`${baseUrl}/probe-widgets/renamed`, { method: 'POST' });
    const created = (await response.json()) as Created;
    await settle();

    const row = (await rowsFor(created.id))[0];
    expect(row?.action).toBe('widget.renamed');
    expect(row?.entity_type).toBe('widget');
    // `colour` was unchanged and is therefore absent from both sides.
    expect(row?.before).toEqual({ name: 'old' });
    expect(row?.after).toEqual({ name: 'new' });
  });

  it('writes one row per recorded entry for a bulk action', async () => {
    const before = await countAll();
    const response = await fetch(`${baseUrl}/probe-widgets/bulk`, { method: 'POST' });
    expect(response.status).toBe(200);
    await settle();
    expect(await countAll()).toBe(before + 3);
  });

  it('does not audit a read', async () => {
    const before = await countAll();
    const response = await fetch(`${baseUrl}/probe-widgets`);
    expect(response.status).toBe(200);
    await settle();
    expect(await countAll()).toBe(before);
  });

  it('does not audit a mutation that was refused', async () => {
    const before = await countAll();
    const response = await fetch(`${baseUrl}/probe-widgets`, { method: 'DELETE' });
    expect(response.status).toBe(409);
    await settle();
    expect(await countAll()).toBe(before);
  });
});
