import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';
import type { HealthStatus } from './app.service.js';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOkResponse({
    description: 'El servicio está en ejecución.',
    schema: { example: { status: 'ok' } },
  })
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
