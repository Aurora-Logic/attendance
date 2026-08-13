-- REQ-H-03: how many restricted holidays one employee may elect from a calendar
-- in its year.
--
-- The three holiday tables themselves already exist -- 0004 created
-- holiday_calendars, holidays and restricted_holiday_elections along with the
-- rest of the attendance model, and 0004's own hand-written section added the
-- employees.holiday_calendar_id and locations.holiday_calendar_id constraints
-- that REQ-H-02 inherits through. This migration adds the one thing the slice
-- found missing: the pool has a size, and nothing recorded it.
--
-- The column sits on the calendar rather than in `settings` because the pool
-- and its limit are one policy. Two locations can run different numbers of
-- optional festivals, and a limit kept away from the list it limits is a limit
-- that drifts from it.
--
-- DEFAULT 0 rather than a guessed number: questionnaire Q36 ("how many may
-- each person take?") is unanswered, and 05-decisions is explicit that no
-- holiday data ships assumed. Zero reads as "this calendar does not run
-- restricted holidays", which is the only honest starting state.
--
-- Not destructive: one ADD COLUMN with a default, and a CHECK that the default
-- already satisfies, so every existing row is valid the moment it lands.
--
-- Reverse with:
--   ALTER TABLE "holiday_calendars" DROP CONSTRAINT "holiday_calendars_restricted_allowance_non_negative";
--   ALTER TABLE "holiday_calendars" DROP COLUMN "restricted_allowance";
ALTER TABLE "holiday_calendars" ADD COLUMN "restricted_allowance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- The API validates this too, but an allowance below zero would let the
-- election check read "remaining = -1" and refuse every pick with a message
-- nobody could act on. A repair script or a future import has no API to go
-- through, so the floor is stated where it cannot be bypassed.
ALTER TABLE "holiday_calendars"
  ADD CONSTRAINT "holiday_calendars_restricted_allowance_non_negative"
  CHECK ("restricted_allowance" >= 0);
