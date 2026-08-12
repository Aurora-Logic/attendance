-- UUID v7 (RFC 9562) for PostgreSQL 16.
--
-- Postgres gains a built-in uuidv7() in 18. Until then every primary key
-- default in this schema depends on this function, so it has to be created
-- before any table.
--
-- Why v7 rather than v4: the keys are time-ordered, so inserts on the
-- append-heavy tables (punches, audit_logs) land at the right-hand edge of the
-- index instead of scattering across it. At 2,000 punches a day for years that
-- is the difference between a clustered index and a fragmented one.
--
-- Layout: 48-bit big-endian Unix milliseconds, 4-bit version, 12 bits random,
-- 2-bit variant, 62 bits random. Built by taking a v4 (which already carries
-- the correct variant bits and 122 bits of randomness), overlaying the
-- timestamp into the first six bytes, and flipping the version nibble from
-- 0100 to 0111.
--
-- clock_timestamp() rather than now(): now() is fixed for the whole
-- transaction, so a batch insert would stamp every row with the same instant
-- and lose the ordering this exists to provide.

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
AS $$
BEGIN
  RETURN encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(
            int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
            FROM 3
          )
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex')::uuid;
END
$$
LANGUAGE plpgsql
VOLATILE;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'RFC 9562 UUID v7. Time-ordered primary keys; replace with the built-in uuidv7() on PostgreSQL 18.';

-- Append-only enforcement, used by audit_logs now and by punches in Phase 1.
--
-- REQ-M-01 and REQ-D-12 both say these records are never updated or deleted,
-- and REQ-B-09a makes them the two things Admin explicitly cannot edit. A
-- convention enforced only in a service layer is not a control: it survives
-- exactly until someone writes a repair script. A trigger applies to every
-- connection, including the table owner and psql.
CREATE OR REPLACE FUNCTION vyuha_forbid_mutation()
RETURNS trigger
AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only; % is not permitted. Corrections are adjusting records, not edits.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$
LANGUAGE plpgsql;
