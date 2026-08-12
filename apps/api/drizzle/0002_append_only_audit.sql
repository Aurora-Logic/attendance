-- REQ-M-01: the audit log is append-only. No updates, no deletes.
--
-- The trigger, not a code convention, is the control. It applies to the
-- application, to a migration, to psql, and to the table owner. REQ-B-09a
-- states this plainly: an editable audit trail is worth nothing in a dispute,
-- and the same trigger function is attached to `punches` in Phase 1.
--
-- Statement-level rather than row-level, so `DELETE FROM audit_logs` fails
-- even when it would have matched no rows. A statement that silently succeeds
-- because the table happened to be empty teaches the wrong lesson.

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION vyuha_forbid_mutation();

COMMENT ON TABLE audit_logs IS
  'Append-only (REQ-M-01). Guarded by the audit_logs_append_only trigger.';

-- TRUNCATE bypasses UPDATE/DELETE triggers entirely, so it needs its own.
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION vyuha_forbid_mutation();
