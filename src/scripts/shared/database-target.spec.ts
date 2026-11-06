import {
  describeDatabaseTarget,
  formatDatabaseTarget,
} from './database-target.js';

describe('describeDatabaseTarget', () => {
  it('devuelve solo el host y el nombre de la base', () => {
    const target = describeDatabaseTarget(
      'postgresql://usuario:clave-secreta@ep-ejemplo.neon.tech/dinno_test?sslmode=require',
    );
    expect(target).toEqual({
      host: 'ep-ejemplo.neon.tech',
      database: 'dinno_test',
    });
    const text = formatDatabaseTarget(target);
    expect(text).not.toContain('usuario');
    expect(text).not.toContain('clave-secreta');
  });

  it('no filtra la cadena de conexión en el error', () => {
    expect(() => describeDatabaseTarget('no-es-una-url clave123')).toThrow(
      'formato de URL',
    );
    try {
      describeDatabaseTarget('no-es-una-url clave123');
    } catch (error) {
      expect(String(error)).not.toContain('clave123');
    }
  });

  it('rechaza una URL sin nombre de base', () => {
    expect(() => describeDatabaseTarget('postgresql://u:p@host/')).toThrow(
      'nombre de la base',
    );
  });
});
