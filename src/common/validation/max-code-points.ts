import { ValidateBy, type ValidationOptions } from 'class-validator';

// Maximum length in Unicode code points, the unit of Postgres varchar(N).
// class-validator's MaxLength counts differently: it skips variation
// selectors (U+FE0F), so "a\uFE0F" × 120 passes MaxLength(120) but is 240
// characters for Postgres and fails the insert with a 500. Like MaxLength,
// it fails for anything that is not a string.
export function MaxCodePoints(
  max: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'maxCodePoints',
      constraints: [max],
      validator: {
        validate: (value: unknown): boolean =>
          typeof value === 'string' && [...value].length <= max,
      },
    },
    options,
  );
}
