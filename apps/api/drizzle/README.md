# Migrations

Forward-only, applied by `pnpm db:migrate` on deploy (technical design 17).

## The snapshot chain is deliberately incomplete

`meta/` holds snapshots for 0000 to 0005 only. Migrations 0006 to 0010 were
hand-written rather than produced by `drizzle-kit generate`, so no snapshot was
ever created for them, and a partial one that appeared for 0007 was removed —
a chain with holes is worse than a chain that stops, because `generate` reads
the previous snapshot to compute its diff and a missing link makes it diff
against the wrong baseline without saying so.

**Before the next `pnpm db:generate`, rebuild the chain.** Point drizzle-kit at
a database that has every migration applied and let it write a fresh snapshot
for the current head; only then generate. Running `generate` against the chain
as it stands will produce a migration that re-creates objects that already
exist.

## `_journal.json` ordering

Entries are applied in array order, and each is skipped if its `when` is below
the highest already recorded in the target database. Both must agree with the
filename order, or a fresh database applies migrations in a different sequence
from the one they were written in.

Five slices appending in parallel broke this once: 0009 landed before 0008 and
was given a smaller `when`, so filename order, array order and timestamp order
all disagreed. It happened to be survivable because neither migration needed
objects the other creates. The array is now sorted by `idx` with timestamps
strictly ascending in the same order, verified both ways — a no-op against the
development database, and a full 44-table build from zero against a fresh one.

Keep it that way when appending: sort by `idx`, and make `when` increase with it.
