import { Matches, type ValidationOptions } from 'class-validator';

// Control and format characters (Unicode category C: zero-width spaces,
// bidirectional marks, line breaks…) do not show on screen: "04" and
// "04\u200B" would be two different tables that look the same, and a name
// with a line break would break the layout. Like Matches, it fails for
// anything that is not a string.
const VISIBLE_CHARACTERS_ONLY = /^\P{C}*$/u;

export function NoInvisibleCharacters(
  options?: ValidationOptions,
): PropertyDecorator {
  return Matches(VISIBLE_CHARACTERS_ONLY, options);
}
