import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Paginación por query (page y pageSize), compartida por las listas paginadas de
// varios módulos (panel del administrador, estado de cuenta). Solo enteros
// escritos en decimal: vacío, "1.5", "0x10", "1e1" o un parámetro repetido son
// NaN y dan 400, nunca 0 ni otro número.
const DIGITS = /^\d+$/;

export function toIntegerOrNaN(value: unknown): number {
  if (typeof value !== 'string') {
    return Number.NaN;
  }
  const text = value.trim();
  return DIGITS.test(text) ? Number(text) : Number.NaN;
}

export const PAGE_INVALID =
  'La página (page) debe ser un número entero mayor o igual a 1.';

export function pageSizeInvalid(max: number): string {
  return `El tamaño de página (pageSize) debe ser un número entero entre 1 y ${max}.`;
}

export const DEFAULT_PAGE = 1;

// page: opcional, entero ≥ 1 (por defecto 1).
export function PageField() {
  return applyDecorators(
    IsOptional(),
    Transform(({ value }) => toIntegerOrNaN(value)),
    IsInt({ message: PAGE_INVALID }),
    Min(1, { message: PAGE_INVALID }),
  );
}

// pageSize: opcional, entero de 1 a max.
export function PageSizeField(max: number) {
  const message = pageSizeInvalid(max);
  return applyDecorators(
    IsOptional(),
    Transform(({ value }) => toIntegerOrNaN(value)),
    IsInt({ message }),
    Min(1, { message }),
    Max(max, { message }),
  );
}
