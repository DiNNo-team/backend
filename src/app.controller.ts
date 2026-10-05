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
    description:
      'El servicio está en ejecución. commit es el commit desplegado (lo define Render); en local es null. El CI lo usa para comprobar que Render desplegó el commit del push.',
    schema: {
      type: 'object',
      required: ['status', 'commit'],
      properties: {
        status: { type: 'string', enum: ['ok'] },
        commit: {
          type: 'string',
          nullable: true,
          description: 'SHA completo del commit desplegado, o null en local.',
        },
      },
      example: {
        status: 'ok',
        commit: '2ad0fcd4b1e8c9a7f3d2e1b0c9a8f7e6d5c4b3a2',
      },
    },
  })
  getHealth(): HealthStatus {
    return this.appService.getHealth();
  }
}
