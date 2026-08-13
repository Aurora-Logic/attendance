import { Module } from '@nestjs/common';

/**
 * Shift masters, weekly-off patterns and rosters (REQ-C-01 to REQ-C-06).
 *
 * A sub-module of the attendance module rather than a sibling of it, because
 * technical design 3 keeps every attendance concern behind one boundary. It is
 * its own file so that one slice can be built without touching the file every
 * other slice also needs.
 *
 * Empty until the slice lands. Registered from the start so the slice can be
 * exercised end to end without editing a shared file to do it.
 */
@Module({})
export class ShiftModule {}
