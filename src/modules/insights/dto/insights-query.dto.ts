import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class InsightsQueryDto {
  @ApiPropertyOptional({
    description:
      'true = no usar el informe guardado y generarlo de nuevo (botón «Actualizar» de la web). Igual cuenta para el límite de 10 por minuto.',
    enum: ['true', 'false'],
  })
  @IsOptional()
  @IsIn(['true', 'false'], {
    message: 'refresh debe ser true o false.',
  })
  refresh?: 'true' | 'false';
}
