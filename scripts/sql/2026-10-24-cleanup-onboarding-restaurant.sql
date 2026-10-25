-- 2026-10-24 · Elizabeth · One-off cleanup in Neon (run it once, by hand).
--
-- onboarding@example.com registered a second restaurant named "Casa 72"
-- (74ae1781-…, 2026-10-22, without coordinates or tables) while testing the
-- web onboarding. This leaves the user without a restaurant, so it can test
-- the onboarding again, and deletes that restaurant with its 7 opening hours.
-- The team's Casa 72 (55bb0482-…) is not touched.
--
-- Every foreign key to restaurants is NO ACTION (users.restaurant_id,
-- tables.restaurant_id, restaurant_schedules.restaurant_id), and table_logs
-- points to tables: the rows go in that order. All in one transaction: if a
-- check fails, nothing changes.

BEGIN;

DO $$
DECLARE
  target constant uuid := '74ae1781-c34c-4cf4-b8a5-035b4fd44aca';
  team_casa72 constant uuid := '55bb0482-be1e-490b-9ba8-7533335d958b';
  found_restaurant restaurants%ROWTYPE;
BEGIN
  IF target = team_casa72 THEN
    RAISE EXCEPTION 'Este script no borra el Casa 72 del equipo (%).', team_casa72;
  END IF;

  SELECT * INTO found_restaurant FROM restaurants WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el restaurante %.', target;
  END IF;
  IF found_restaurant.latitude IS NOT NULL OR found_restaurant.longitude IS NOT NULL THEN
    RAISE EXCEPTION 'El restaurante % tiene coordenadas: no es el de la prueba de onboarding.', target;
  END IF;
  IF EXISTS (SELECT 1 FROM tables WHERE restaurant_id = target) THEN
    RAISE EXCEPTION 'El restaurante % tiene mesas: no se borra.', target;
  END IF;
  IF (SELECT array_agg(email) FROM users WHERE restaurant_id = target)
     IS DISTINCT FROM ARRAY['onboarding@example.com']::varchar[] THEN
    RAISE EXCEPTION 'El dueño del restaurante % no es solo onboarding@example.com.', target;
  END IF;
END $$;

UPDATE users
SET restaurant_id = NULL
WHERE email = 'onboarding@example.com'
  AND restaurant_id = '74ae1781-c34c-4cf4-b8a5-035b4fd44aca';

-- No tables (checked above), so nothing in tables or table_logs.
DELETE FROM restaurant_schedules
WHERE restaurant_id = '74ae1781-c34c-4cf4-b8a5-035b4fd44aca';

DELETE FROM restaurants
WHERE id = '74ae1781-c34c-4cf4-b8a5-035b4fd44aca';

COMMIT;

-- Result: onboarding@example.com without a restaurant, the restaurant gone,
-- and the team's Casa 72 still owned by its owner.
SELECT
  (SELECT restaurant_id FROM users WHERE email = 'onboarding@example.com') AS onboarding_restaurant_id,
  (SELECT count(*) FROM restaurants WHERE id = '74ae1781-c34c-4cf4-b8a5-035b4fd44aca') AS deleted_restaurant_left,
  (SELECT count(*) FROM restaurant_schedules WHERE restaurant_id = '74ae1781-c34c-4cf4-b8a5-035b4fd44aca') AS deleted_schedules_left,
  (SELECT count(*) FROM restaurants WHERE name = 'Casa 72') AS restaurants_named_casa_72,
  (SELECT email FROM users WHERE restaurant_id = '55bb0482-be1e-490b-9ba8-7533335d958b') AS team_casa_72_owner;
