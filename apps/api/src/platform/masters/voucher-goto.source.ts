import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS, type GoToRecord } from '@vyuha/shared';

import type { Principal } from '../rbac/principal.js';
import { GoToSourceRegistry, type GoToSource } from '../search/go-to-source.registry.js';
import { MastersService } from './masters.service.js';

/**
 * Vouchers in Go To — 09 §6's sentence made true: "once typing a voucher
 * number opens that voucher, the sidebar stops being how anyone navigates".
 * Same authority as the Vouchers screen (`listVouchers`, `receivables.view`),
 * so the palette finds exactly what the screen would show. The voucher
 * number is the code a person quotes from memory, so it takes the exact-code
 * ranking tier.
 */
@Injectable()
export class VoucherGoToSource implements GoToSource, OnModuleInit {
  readonly recordType = 'voucher';
  readonly permissions = [PERMISSIONS.RECEIVABLES_VIEW] as const;

  constructor(
    private readonly registry: GoToSourceRegistry,
    private readonly masters: MastersService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async search(principal: Principal, term: string, limit: number): Promise<GoToRecord[]> {
    const { data } = await this.masters.listVouchers(principal, {
      page: 1,
      pageSize: limit,
      q: term,
      includeCancelled: true,
    });

    return data.map((voucher) => ({
      type: this.recordType,
      id: voucher.id,
      title: `${voucher.voucherType} ${voucher.voucherNumber}`.trim(),
      subtitle: [voucher.partyName || null, voucher.date, voucher.isCancelled ? 'cancelled' : null]
        .filter((part): part is string => part !== null)
        .join(' · '),
      code: voucher.voucherNumber === '' ? null : voucher.voucherNumber,
    }));
  }
}
