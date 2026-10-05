import { PartialType } from '@nestjs/swagger';
import { RestaurantFieldsDto } from './restaurant-fields.dto.js';

// Every field optional (PATCH), same rules as registration. With
// skipNullProperties: false only an absent field is skipped: null is validated
// and rejected, so it can never reach a NOT NULL column.
export class UpdateRestaurantDto extends PartialType(RestaurantFieldsDto, {
  skipNullProperties: false,
}) {}
