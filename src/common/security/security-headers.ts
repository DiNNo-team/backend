import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

// Cabeceras de seguridad (Sprint 4, tarea 6.1.4), con helmet. Además de sus
// valores por defecto (HSTS de un año, nosniff, sin X-Powered-By, Referrer-Policy
// no-referrer, CORP/COOP same-origin…):
// - La API solo responde JSON: su Content-Security-Policy no permite cargar
//   nada ni que otra página la ponga en un iframe.
// - Swagger (/docs) es una página con scripts y estilos propios: usa la CSP
//   por defecto de helmet, que los permite desde el mismo origen.
// HSTS solo lo aplica el navegador sobre HTTPS; en local (http) no tiene efecto.
const API_CSP = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
  },
};

export function securityHeaders(docsPath: string) {
  const forApi = helmet({ contentSecurityPolicy: API_CSP });
  const forDocs = helmet();
  return (req: Request, res: Response, next: NextFunction): void => {
    const isDocs =
      req.path === docsPath ||
      req.path.startsWith(`${docsPath}/`) ||
      req.path.startsWith(`${docsPath}-`);
    (isDocs ? forDocs : forApi)(req, res, next);
  };
}
