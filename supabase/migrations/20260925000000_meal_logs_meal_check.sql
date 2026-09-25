-- Lock meal_logs.meal to the six meal values the app writes (the MEALS
-- constant in src/App.jsx). Optional hardening: the app works without it.
--
-- Run the check below first. If it returns any rows, those existing values
-- would make the ALTER fail — fix or remap them before adding the constraint.
--
--   select meal, count(*) from meal_logs
--   where meal is null
--      or meal not in ('Breakfast', 'Before training', 'Lunch', 'After training', 'Dinner', 'Snack')
--   group by meal;
--
-- NULL is still allowed by a CHECK constraint (only a NOT NULL would block it).

alter table meal_logs drop constraint if exists meal_logs_meal_check;
alter table meal_logs
  add constraint meal_logs_meal_check
  check (meal in ('Breakfast', 'Before training', 'Lunch', 'After training', 'Dinner', 'Snack'));
