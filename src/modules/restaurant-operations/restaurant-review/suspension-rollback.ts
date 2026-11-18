// Mensaje de AddRestaurantSuspension.down cuando quedan restaurantes
// suspendidos. Vive aquí y no en src/migrations: TypeORM trata cada export de
// dist/migrations como una clase de migración y hace `new` sobre ella.
export const SUSPENSION_DOWN_BLOCKED = (count: number) =>
  `No se puede revertir AddRestaurantSuspension: hay ${count} restaurante(s) suspendido(s). Reactívalos desde el panel del administrador y vuelve a intentarlo.`;
