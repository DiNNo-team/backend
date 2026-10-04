import { DataSource } from 'typeorm';

// Used only by the TypeORM CLI, outside Nest DI: the one place allowed to read process.env.
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not defined. Run the TypeORM CLI with --env-file=.env.',
  );
}

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  synchronize: false,
  ssl: databaseUrl.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/migrations/*.js'],
});
