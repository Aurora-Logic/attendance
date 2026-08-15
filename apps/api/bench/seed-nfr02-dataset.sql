-- NFR-02: "Any report renders its first page in under 1.5 seconds at 500
-- employees x 24 months of data. Seed a dataset of this size and benchmark
-- against it."
--
-- The dev database has never held anything like this -- roughly 3,500
-- attendance days across every fixture org ever created -- so every report in
-- the product is proven correct and unproven at size. This builds the stated
-- shape in an org of its own so it can be dropped again without touching a
-- fixture anyone else depends on.
--
-- 500 employees x 731 days = 365,500 attendance days.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO organizations (id, name, timezone, date_format, week_start, leave_year_start_month)
VALUES ('01900000-0000-7000-8000-00000000bbbb', 'NFR-02 Benchmark Org', 'Asia/Kolkata', 'dd-MM-yyyy', 1, 4)
ON CONFLICT (id) DO NOTHING;

-- Departments and locations, so the filtered variants of each report have
-- something real to narrow on rather than measuring the unfiltered path twice.
INSERT INTO departments (org_id, code, name)
SELECT '01900000-0000-7000-8000-00000000bbbb', 'BD' || n, 'Bench Dept ' || n
FROM generate_series(1, 10) n
ON CONFLICT DO NOTHING;

INSERT INTO locations (org_id, code, name, timezone)
SELECT '01900000-0000-7000-8000-00000000bbbb', 'BL' || n, 'Bench Site ' || n, 'Asia/Kolkata'
FROM generate_series(1, 5) n
ON CONFLICT DO NOTHING;

INSERT INTO employees
  (org_id, employee_code, first_name, last_name, date_of_joining, employment_type, status,
   is_field_staff, department_id, location_id)
SELECT
  '01900000-0000-7000-8000-00000000bbbb',
  'BM-' || lpad(n::text, 4, '0'),
  'Bench',
  'Employee ' || n,
  DATE '2024-01-01',
  'PERMANENT',
  'ACTIVE',
  false,
  (SELECT id FROM departments WHERE org_id = '01900000-0000-7000-8000-00000000bbbb'
    ORDER BY code OFFSET (n % 10) LIMIT 1),
  (SELECT id FROM locations WHERE org_id = '01900000-0000-7000-8000-00000000bbbb'
    ORDER BY code OFFSET (n % 5) LIMIT 1)
FROM generate_series(1, 500) n
ON CONFLICT DO NOTHING;

/*
 * Two years of days, with a realistic spread rather than 365,500 identical
 * rows: a report whose every row is the same value can be answered from a
 * single index page and would flatter the timing. Weekends are WEEKLY_OFF, one
 * day in twenty is ABSENT, one in twelve carries a late arrival, and worked
 * minutes vary per employee and day.
 */
INSERT INTO attendance_days
  (org_id, employee_id, date, worked_minutes, break_minutes, ot_minutes, status,
   late_minutes, early_exit_minutes, flags, is_manual_override, computed_at, locked)
SELECT
  '01900000-0000-7000-8000-00000000bbbb',
  e.id,
  d::date,
  CASE WHEN EXTRACT(ISODOW FROM d) >= 6 THEN 0
       WHEN (e.rn + EXTRACT(DOY FROM d)::int) % 20 = 0 THEN 0
       ELSE 450 + ((e.rn + EXTRACT(DOY FROM d)::int) % 90) END,
  CASE WHEN EXTRACT(ISODOW FROM d) >= 6 THEN 0 ELSE 45 END,
  CASE WHEN (e.rn + EXTRACT(DOY FROM d)::int) % 15 = 0 THEN 60 ELSE 0 END,
  (CASE WHEN EXTRACT(ISODOW FROM d) >= 6 THEN 'WEEKLY_OFF'
        WHEN (e.rn + EXTRACT(DOY FROM d)::int) % 20 = 0 THEN 'ABSENT'
        WHEN (e.rn + EXTRACT(DOY FROM d)::int) % 33 = 0 THEN 'HALF_DAY'
        ELSE 'PRESENT' END)::attendance_status,
  CASE WHEN EXTRACT(ISODOW FROM d) < 6 AND (e.rn + EXTRACT(DOY FROM d)::int) % 12 = 0
       THEN 10 + ((e.rn + EXTRACT(DOY FROM d)::int) % 40) ELSE 0 END,
  CASE WHEN EXTRACT(ISODOW FROM d) < 6 AND (e.rn + EXTRACT(DOY FROM d)::int) % 18 = 0
       THEN 15 ELSE 0 END,
  CASE WHEN EXTRACT(ISODOW FROM d) < 6 AND (e.rn + EXTRACT(DOY FROM d)::int) % 12 = 0
       THEN ARRAY['late_in'] ELSE ARRAY[]::text[] END,
  false,
  now(),
  false
FROM (
  SELECT id, row_number() OVER (ORDER BY employee_code) AS rn
    FROM employees
   WHERE org_id = '01900000-0000-7000-8000-00000000bbbb'
) e
CROSS JOIN generate_series(DATE '2024-09-01', DATE '2026-08-31', INTERVAL '1 day') d
ON CONFLICT DO NOTHING;

COMMIT;

ANALYZE attendance_days;
ANALYZE employees;

SELECT
  (SELECT count(*) FROM employees WHERE org_id = '01900000-0000-7000-8000-00000000bbbb') AS employees,
  (SELECT count(*) FROM attendance_days WHERE org_id = '01900000-0000-7000-8000-00000000bbbb') AS attendance_days,
  (SELECT min(date) FROM attendance_days WHERE org_id = '01900000-0000-7000-8000-00000000bbbb') AS from_date,
  (SELECT max(date) FROM attendance_days WHERE org_id = '01900000-0000-7000-8000-00000000bbbb') AS to_date;
