// Mensaje de AddPlatformAdminRole.down cuando quedan usuarios platform_admin.
// Vive aquí y no en src/migrations: TypeORM trata cada export de
// dist/migrations como una clase de migración y hace `new` sobre ella.
export const PLATFORM_ADMIN_DOWN_BLOCKED = (count: number) =>
  `No se puede revertir AddPlatformAdminRole: hay ${count} usuario(s) con el rol platform_admin. Cámbiales el rol o bórralos a mano y vuelve a intentarlo.`;
