import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { DEFAULT_PAGE } from '../../../common/dto/page-query.js';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator.js';
import {
  CurrentUser,
  CurrentUserGuard,
  Roles,
  UserRole,
  type CurrentUserData,
} from '../../identity-access/index.js';
import { restaurantNotFound } from '../../restaurant-operations/index.js';
import { BillingPeriodsService } from '../billing/billing-periods.service.js';
import { BILLING_PAGE_SIZE_DEFAULT } from '../reports/dto/report-query.dto.js';
import {
  AdminPlatformDocs,
  billingConflictResponse,
  MONTH_BAD_REQUEST,
  RESTAURANT_NOT_FOUND_RESPONSE,
} from './admin-platform.swagger.js';
import {
  ADMIN_LIST_PAGE_SIZE_DEFAULT,
  AdminBillingDetailQueryDto,
  AdminMonthPageQueryDto,
} from './dto/admin-platform-query.dto.js';
import {
  AdminBillingDetailDto,
  AdminBillingPageDto,
} from './dto/admin-platform-response.dto.js';
import { PlatformReportsService } from './platform-reports.service.js';

// Un :restaurantId que no es UUID responde el mismo 404 que uno que no existe
// (igual que /v1/admin/restaurants/:id).
const RestaurantIdParam = () =>
  Param(
    'restaurantId',
    new ParseUUIDPipe({ exceptionFactory: restaurantNotFound }),
  );

const RESTAURANT_PARAM = {
  name: 'restaurantId',
  format: 'uuid',
  description: 'Id del restaurante.',
};
const MONTH_PARAM = {
  name: 'month',
  description: 'Mes (AAAA-MM, hora de Bogotá).',
  example: '2026-10',
};

// Estado de cobro mensual por restaurante (panel del administrador de DiNNo,
// Sprint 4). El dinero es siempre SUM(check_ins.fee_cop). No hay pasarela de
// pagos: el administrador marca a mano un mes como cobrado.
@AdminPlatformDocs()
@Roles(UserRole.PLATFORM_ADMIN)
@UseGuards(CurrentUserGuard)
@Controller('admin/billing')
export class AdminBillingController {
  constructor(
    private readonly reports: PlatformReportsService,
    private readonly periods: BillingPeriodsService,
  ) {}

  @Get()
  @RateLimit('adminReports')
  @ApiOperation({
    summary: 'Cobro del mes por restaurante',
    description:
      'Restaurantes aprobados y suspendidos, también con 0 check-ins, de mayor a menor monto (desempate por nombre). status por restaurante: in_progress (mes en curso, no se puede marcar), pending (mes cerrado sin cobrar) o paid. totals: check-ins y monto del mes de toda la plataforma, lo cobrado (montos guardados) y lo pendiente (recalculado). month por defecto, el mes en curso.',
  })
  @ApiOkResponse({ type: AdminBillingPageDto })
  @ApiBadRequestResponse(MONTH_BAD_REQUEST)
  list(@Query() query: AdminMonthPageQueryDto): Promise<AdminBillingPageDto> {
    return this.reports.billingList(this.reports.resolveMonth(query.month), {
      page: query.page ?? DEFAULT_PAGE,
      pageSize: query.pageSize ?? ADMIN_LIST_PAGE_SIZE_DEFAULT,
    });
  }

  @Get(':restaurantId')
  @RateLimit('adminReports')
  @ApiOperation({
    summary: 'Cobro de un restaurante en un mes',
    description:
      'El estado del mes, el monto recalculado y, si está cobrado, lo que se guardó al marcarlo (snapshot) y amountMismatch si no coinciden (no debería pasar; no se corrige solo). items: una página de check-ins, el más reciente primero (pageSize por defecto 50, máximo 200), sin datos del comensal ni de la reserva.',
  })
  @ApiParam(RESTAURANT_PARAM)
  @ApiOkResponse({ type: AdminBillingDetailDto })
  @ApiBadRequestResponse(MONTH_BAD_REQUEST)
  @ApiNotFoundResponse(RESTAURANT_NOT_FOUND_RESPONSE)
  detail(
    @RestaurantIdParam() restaurantId: string,
    @Query() query: AdminBillingDetailQueryDto,
  ): Promise<AdminBillingDetailDto> {
    return this.reports.billingDetail(
      restaurantId,
      this.reports.resolveMonth(query.month),
      {
        page: query.page ?? DEFAULT_PAGE,
        pageSize: query.pageSize ?? BILLING_PAGE_SIZE_DEFAULT,
      },
    );
  }

  @Post(':restaurantId/:month/mark-paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marcar un mes como cobrado',
    description:
      'Solo un mes cerrado (anterior al mes en curso, Bogotá) y con check-ins. Guarda el monto y los check-ins de ese momento (snapshot), quién y cuándo. Dos marcas a la vez: una gana y la otra recibe PERIOD_ALREADY_PAID. Responde el detalle actualizado (primera página).',
  })
  @ApiParam(RESTAURANT_PARAM)
  @ApiParam(MONTH_PARAM)
  @ApiOkResponse({ type: AdminBillingDetailDto })
  @ApiBadRequestResponse(MONTH_BAD_REQUEST)
  @ApiNotFoundResponse(RESTAURANT_NOT_FOUND_RESPONSE)
  @ApiConflictResponse(
    billingConflictResponse(
      'El mes no ha terminado (PERIOD_NOT_CLOSED), no tiene check-ins (NOTHING_TO_BILL) o ya está cobrado (PERIOD_ALREADY_PAID). La web vuelve a consultar el detalle.',
      ['PERIOD_NOT_CLOSED', 'NOTHING_TO_BILL', 'PERIOD_ALREADY_PAID'],
    ),
  )
  async markPaid(
    @CurrentUser() admin: CurrentUserData,
    @RestaurantIdParam() restaurantId: string,
    @Param('month') monthText: string,
  ): Promise<AdminBillingDetailDto> {
    const month = this.reports.resolveMonth(monthText);
    await this.periods.markPaid(admin.userId, restaurantId, month);
    return this.firstPage(restaurantId, monthText);
  }

  @Post(':restaurantId/:month/mark-pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deshacer la marca de cobrado',
    description:
      'Para corregir un error: vuelve a pending y borra el snapshot y los datos del pago. Solo desde paid. Responde el detalle actualizado (primera página).',
  })
  @ApiParam(RESTAURANT_PARAM)
  @ApiParam(MONTH_PARAM)
  @ApiOkResponse({ type: AdminBillingDetailDto })
  @ApiBadRequestResponse(MONTH_BAD_REQUEST)
  @ApiNotFoundResponse(RESTAURANT_NOT_FOUND_RESPONSE)
  @ApiConflictResponse(
    billingConflictResponse(
      'El mes no está marcado como cobrado (PERIOD_NOT_PAID). La web vuelve a consultar el detalle.',
      ['PERIOD_NOT_PAID'],
    ),
  )
  async markPending(
    @RestaurantIdParam() restaurantId: string,
    @Param('month') monthText: string,
  ): Promise<AdminBillingDetailDto> {
    const month = this.reports.resolveMonth(monthText);
    await this.periods.markPending(restaurantId, month);
    return this.firstPage(restaurantId, monthText);
  }

  private firstPage(
    restaurantId: string,
    monthText: string,
  ): Promise<AdminBillingDetailDto> {
    return this.reports.billingDetail(
      restaurantId,
      this.reports.resolveMonth(monthText),
      { page: DEFAULT_PAGE, pageSize: BILLING_PAGE_SIZE_DEFAULT },
    );
  }
}
