// Confidencialidad del panel del administrador (Sprint 4): ninguna respuesta
// nueva trae datos personales de comensales ni códigos de reserva. Recorre el
// cuerpo completo (objetos y listas, a cualquier profundidad) y falla si
// aparece una de estas claves, o cualquier clave que hable de un correo, salvo
// las que la prueba permite explícitamente (por ejemplo ownerEmail, que solo
// existe en el detalle de solicitudes del administrador).
export const FORBIDDEN_KEYS = [
  'email',
  'displayName',
  'dinerName',
  'dinerId',
  'code',
  'userEmail',
] as const;

export function personalDataKeys(
  body: unknown,
  allow: readonly string[] = [],
  path = '$',
): string[] {
  if (Array.isArray(body)) {
    return body.flatMap((item, index) =>
      personalDataKeys(item, allow, `${path}[${index}]`),
    );
  }
  if (body === null || typeof body !== 'object') {
    return [];
  }
  return Object.entries(body).flatMap(([key, value]) => {
    const found =
      !allow.includes(key) &&
      ((FORBIDDEN_KEYS as readonly string[]).includes(key) ||
        /email/i.test(key) ||
        /diner/i.test(key))
        ? [`${path}.${key}`]
        : [];
    return [...found, ...personalDataKeys(value, allow, `${path}.${key}`)];
  });
}

export function expectNoPersonalData(
  body: unknown,
  { allow = [] }: { allow?: readonly string[] } = {},
): void {
  expect(personalDataKeys(body, allow)).toEqual([]);
}
