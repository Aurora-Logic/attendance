import {
  Controller,
  Get,
  MethodNotAllowedException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  PERMISSIONS,
  partyListQuerySchema,
  priceListListQuerySchema,
  stockItemListQuerySchema,
  voucherListQuerySchema,
  type Paginated,
  type PartyView,
  type PriceListEntryView,
  type StockItemView,
  type VoucherDetailView,
  type VoucherView,
  type ItemLifecycle,
  type PartyLifecycle, lifecycleAnalyticsQuerySchema, type ItemAnalytics, type PartyAnalytics } from '@vyuha/shared';

import { createZodDto } from '../common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../rbac/principal.js';
import { RequirePermission } from '../rbac/route-policy.js';
import { LifecycleAnalyticsService } from './lifecycle-analytics.service.js';
import { LifecycleService } from './lifecycle.service.js';
import { MastersService } from './masters.service.js';

class PartyListQueryDto extends createZodDto(partyListQuerySchema) {}
class LifecycleAnalyticsQueryDto extends createZodDto(lifecycleAnalyticsQuerySchema) {}
class StockItemListQueryDto extends createZodDto(stockItemListQuerySchema) {}
class PriceListListQueryDto extends createZodDto(priceListListQuerySchema) {}
class VoucherListQueryDto extends createZodDto(voucherListQuerySchema) {}

/**
 * `/api/v1/masters/*` (09 §5): the Tally masters projection, read-only —
 * "no POST, PATCH or DELETE, by design".
 *
 * The write methods below exist to say so. Left unrouted they would answer
 * 404, which reads as a wrong address and invites a client author to try a
 * different path; 405 states the actual rule (REQ-R-04, permanent): a new
 * customer is created in Tally, where the accountant works, and appears here
 * on the next pull. The 6b exit criteria assert this verbatim.
 */
@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService,
    private readonly lifecycle: LifecycleService,
    private readonly analytics: LifecycleAnalyticsService,
  ) {}

  @Get('parties')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  listParties(
    @CurrentUser() principal: Principal,
    @Query() query: PartyListQueryDto,
  ): Promise<Paginated<PartyView>> {
    return this.masters.listParties(principal, query);
  }

  @Get('parties/:id')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  findParty(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PartyView> {
    return this.masters.findParty(principal, id);
  }

  /** REQ-R-02: `GET /masters/items` in 09 §5's spelling. */
  @Get('items')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  listStockItems(
    @CurrentUser() principal: Principal,
    @Query() query: StockItemListQueryDto,
  ): Promise<Paginated<StockItemView>> {
    return this.masters.listStockItems(principal, query);
  }

  @Get('items/:id')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  findStockItem(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<StockItemView> {
    return this.masters.findStockItem(principal, id);
  }

  /** Owner, 22 Aug 2026: the life of one item across sales, purchase and Tally, as far as this person may read each. */
  @Get('items/:id/lifecycle')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  itemLifecycle(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<ItemLifecycle> {
    return this.lifecycle.item(principal, id);
  }

  /** The period half of the item's life (owner, 22 Aug 2026): KPIs with a comparison, months, who, and the grid. */
  @Get('items/:id/analytics')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  itemAnalytics(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Query() query: LifecycleAnalyticsQueryDto): Promise<ItemAnalytics> {
    return this.analytics.item(principal, id, query);
  }

  /** The life of one party, as the customer it is, the vendor it is, or both. */
  @Get('parties/:id/lifecycle')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  partyLifecycle(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<PartyLifecycle> {
    return this.lifecycle.party(principal, id);
  }

  @Get('parties/:id/analytics')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  partyAnalytics(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Query() query: LifecycleAnalyticsQueryDto): Promise<PartyAnalytics> {
    return this.analytics.party(principal, id, query);
  }

  /** REQ-R-03: `GET /masters/price-lists`. */
  @Get('price-lists')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  listPriceLists(
    @CurrentUser() principal: Principal,
    @Query() query: PriceListListQueryDto,
  ): Promise<Paginated<PriceListEntryView>> {
    return this.masters.listPriceListEntries(principal, query);
  }

  /**
   * Phase 6c: the books, read-only like the masters, behind `receivables.view`
   * rather than `masters.tally.view` — a voucher is money moving, and 08 §2.2
   * gives it to Accounts and Sales managers, not to everyone who may look up
   * a party.
   */
  @Get('vouchers')
  @RequirePermission(PERMISSIONS.RECEIVABLES_VIEW)
  listVouchers(
    @CurrentUser() principal: Principal,
    @Query() query: VoucherListQueryDto,
  ): Promise<Paginated<VoucherView>> {
    return this.masters.listVouchers(principal, query);
  }

  @Get('vouchers/:id')
  @RequirePermission(PERMISSIONS.RECEIVABLES_VIEW)
  findVoucher(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VoucherDetailView> {
    return this.masters.findVoucher(principal, id);
  }

  @Post('parties')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  refuseCreate(): never {
    throw new MethodNotAllowedException(
      'Masters are read-only in Vyuha (REQ-R-04). A new party is created in Tally and appears here on the next pull.',
    );
  }

  @Patch('parties/:id')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  refuseEdit(): never {
    throw new MethodNotAllowedException(
      'Masters are read-only in Vyuha (REQ-R-04). Edit the party in Tally; the change arrives on the next pull.',
    );
  }

  /** 13 REQ-AC-07: a stock figure is never written here — not the item, not its closing balance. */
  @Post('items')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  refuseCreateItem(): never {
    throw new MethodNotAllowedException(
      'Stock items are read-only in Vyuha (REQ-R-04, REQ-AC-07). Create the item in Tally; it appears here on the next pull.',
    );
  }

  @Patch('items/:id')
  @RequirePermission(PERMISSIONS.MASTERS_TALLY_VIEW)
  refuseEditItem(): never {
    throw new MethodNotAllowedException(
      'Stock items are read-only in Vyuha (REQ-R-04, REQ-AC-07). Stock moves only through a Delivery Note or a Receipt Note in Tally.',
    );
  }
}

/*
 * There is deliberately no DELETE handler. `DELETE /masters/:entityType/:id`
 * belongs to the recycle bin's soft-delete surface, which registers first and
 * already refuses "parties" by name — it is not in SOFT_DELETABLE_ENTITIES
 * and never will be, because a party removed in Tally is marked absent here
 * and retained (REQ-R-06). A second handler on the same path would be dead
 * code that a route-order change could silently bring to life.
 */
