-- REQ-B-10: "5 failed logins per account per 15 min (then 15-min lockout)".
--
-- `users.failed_attempts` alone cannot express "per 15 min" -- it has no
-- window, so five failures spread over a year would lock the account. This
-- column records when the current run of failures began; the login service
-- restarts the count once the window has passed.
--
-- Additive and nullable, so it applies to a live table without a rewrite and
-- existing rows read as "no failures recorded yet".
-- Reverse with: ALTER TABLE "users" DROP COLUMN "failed_attempts_since";

ALTER TABLE "users" ADD COLUMN "failed_attempts_since" timestamp with time zone;
