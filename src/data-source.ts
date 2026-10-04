import { DataSource } from 'typeorm';

// Used by the TypeORM CLI and the seed, outside Nest DI: the one place allowed to read process.env.
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not defined. Run it through npm (migration:* or seed), which loads .env.',
  );
}

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  synchronize: false,
  uuidExtension: 'pgcrypto',
  installExtensions: false,
  ssl: databaseUrl.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/migrations/*.js'],
});
