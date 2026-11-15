import { BadRequestException, Injectable } from '@nestjs/common';
import { Clock } from '../../search-availability/index.js';
import { BillingStatementService } from '../billing/billing-statement.service.js';
import type { BillingStatementResponseDto } from './dto/report-response.dto.js';
import {
  parseReportPeriod,
  type ReportPeriod,
  type ReportPeriodQuery,
} from './report-period.js';

// Los reportes del restaurante de la sesión (CLAUDE.md §11, "Cobro por
// check-in"): resuelve el periodo y arma la respuesta. Las consultas viven en
// BillingStatementService.
@Injectable()
export class RestaurantReportsService {
  constructor(
    private readonly billing: BillingStatementService,
    private readonly clock: Clock,
  ) {}

  async billingStatement(
    restaurantId: string,
    query: ReportPeriodQuery & { page: number; pageSize: number },
  ): Promise<BillingStatementResponseDto> {
    const period = this.periodOf(query);
    const { page, pageSize } = query;
    const statement = await this.billing.statement(restaurantId, period, {
      page,
      pageSize,
    });
    return {
      period: periodDto(period),
      ...statement,
      page,
      pageSize,
      serverTime: this.clock.now().toISOString(),
    };
  }

  // 400 con la lista de problemas, como los demás errores de validación.
  private periodOf(query: ReportPeriodQuery): ReportPeriod {
    const result = parseReportPeriod(
      { from: query.from, to: query.to },
      this.clock.now(),
    );
    if (!result.ok) {
      throw new BadRequestException(result.errors);
    }
    return result.period;
  }
}

function periodDto({ from, to, timezone }: ReportPeriod) {
  return { from, to, timezone };
}
