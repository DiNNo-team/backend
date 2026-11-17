import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import type { Type } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { CurrentUserGuard, UserRole } from './modules/identity-access/index.js';
import { ROLES_METADATA } from './modules/identity-access/roles/roles.decorator.js';

// RolesGuard deja pasar cualquier ruta SIN @Roles. Esta prueba recorre, por
// reflexión y sin instanciar nada, todos los controladores de la aplicación
// real (AppModule y sus imports, recursivamente) y falla si un handler cuya ruta
// empieza por "admin" no exige exactamente PLATFORM_ADMIN o no pasa por
// CurrentUserGuard. Así un controlador o una ruta nueva bajo /v1/admin nunca
// queda abierta por olvido, venga del módulo que venga.

type ModuleRef =
  Type | { module: Type; imports?: unknown[] } | Promise<unknown>;

function moduleClass(ref: unknown): Type | null {
  if (typeof ref === 'function') {
    return ref as Type;
  }
  if (ref && typeof ref === 'object' && 'module' in ref) {
    return (ref as { module: Type }).module;
  }
  return null;
}

function controllersOf(root: Type): Set<Type> {
  const seen = new Set<Type>();
  const controllers = new Set<Type>();
  const visit = (ref: ModuleRef) => {
    const module = moduleClass(ref);
    if (module === null || seen.has(module)) {
      return;
    }
    seen.add(module);
    const imports = [
      ...((Reflect.getMetadata('imports', module) as unknown[]) ?? []),
      ...((ref as { imports?: unknown[] }).imports ?? []),
    ];
    for (const controller of (Reflect.getMetadata('controllers', module) ??
      []) as Type[]) {
      controllers.add(controller);
    }
    for (const imported of imports) {
      visit(imported as ModuleRef);
    }
  };
  visit(root);
  return controllers;
}

interface Handler {
  route: string;
  roles: UserRole[] | undefined;
  guards: unknown[];
}

function joinPath(...parts: (string | string[] | undefined)[]): string {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : [part ?? '']))
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '')
    .join('/');
}

function handlersOf(controller: Type): Handler[] {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as
    string | string[] | undefined;
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => prototype[name])
    .filter(
      (handler): handler is object =>
        typeof handler === 'function' &&
        Reflect.getMetadata(PATH_METADATA, handler) !== undefined,
    )
    .map((handler) => ({
      route: joinPath(
        base,
        Reflect.getMetadata(PATH_METADATA, handler) as string | string[],
      ),
      roles: (Reflect.getMetadata(ROLES_METADATA, handler) ??
        Reflect.getMetadata(ROLES_METADATA, controller)) as
        UserRole[] | undefined,
      guards: [
        ...((Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ??
          []),
        ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? []),
      ],
    }));
}

const ADMIN_HANDLERS = [...controllersOf(AppModule)]
  .flatMap(handlersOf)
  .filter((handler) => handler.route.split('/')[0] === 'admin');

describe('Rutas del administrador de DiNNo (/v1/admin/*)', () => {
  it('encuentra todas las rutas del panel (la prueba no es vacía)', () => {
    // 4 de revisión + suspender y reactivar + 4 de cobro + overview, activity
    // y platform/metrics. Si agregas una ruta, sube este número.
    expect(ADMIN_HANDLERS.map((handler) => handler.route).sort()).toEqual(
      [
        'admin/activity',
        'admin/billing',
        'admin/billing/:restaurantId',
        'admin/billing/:restaurantId/:month/mark-paid',
        'admin/billing/:restaurantId/:month/mark-pending',
        'admin/overview',
        'admin/platform/metrics',
        'admin/restaurants',
        'admin/restaurants/:id',
        'admin/restaurants/:id/approve',
        'admin/restaurants/:id/reactivate',
        'admin/restaurants/:id/reject',
        'admin/restaurants/:id/suspend',
      ].sort(),
    );
  });

  it.each(ADMIN_HANDLERS.map((handler) => [handler.route, handler] as const))(
    '%s exige exactamente PLATFORM_ADMIN y pasa por CurrentUserGuard',
    (_route, handler) => {
      expect(handler.roles).toEqual([UserRole.PLATFORM_ADMIN]);
      expect(handler.guards).toContain(CurrentUserGuard);
    },
  );
});
