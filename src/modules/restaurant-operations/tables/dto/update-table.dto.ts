import { PartialType } from '@nestjs/swagger';
import { CreateTableDto } from './create-table.dto.js';

// Edit (PBI 7): identifier and/or capacity, with exactly the create rules.
// With skipNullProperties: false only an absent field is skipped: null is
// validated and rejected, so it never reaches a NOT NULL column. At least one
// field is required; the service answers 400 for an empty body.
export class UpdateTableDto extends PartialType(CreateTableDto, {
  skipNullProperties: false,
}) {}
