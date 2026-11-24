// Dónde va a leer o escribir un script: solo el host y el nombre de la base,
// nunca el usuario ni la clave, para que quien lo corre confirme el destino.
export interface DatabaseTarget {
  host: string;
  database: string;
}

export function describeDatabaseTarget(databaseUrl: string): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // El mensaje no incluye la cadena: puede traer la clave.
    throw new Error('DATABASE_URL no tiene un formato de URL válido.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database) {
    throw new Error('DATABASE_URL no indica el host o el nombre de la base.');
  }
  return { host: url.hostname, database };
}

export function formatDatabaseTarget({ host, database }: DatabaseTarget) {
  return `Base de datos: ${database} (host ${host})`;
}
