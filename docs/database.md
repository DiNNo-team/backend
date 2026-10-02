# Database Schema

The `users` table below documents the application model. It has not been
created in the database; its TypeORM migration remains pending.

## `users`

| Column          | PostgreSQL type   | Constraints                                            |
| --------------- | ----------------- | ------------------------------------------------------ |
| `id`            | `uuid`            | Primary key, generated UUID                            |
| `firebase_uid`  | `varchar`         | Unique, not null                                       |
| `email`         | `varchar`         | Unique, not null                                       |
| `role`          | `users_role_enum` | Not null; currently `restaurant`                       |
| `restaurant_id` | `uuid`            | Nullable; plain column with no relation or foreign key |
| `created_at`    | `timestamptz`     | Not null, managed by TypeORM                           |
| `updated_at`    | `timestamptz`     | Not null, managed by TypeORM                           |
