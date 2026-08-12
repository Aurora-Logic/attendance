import { Module } from '@nestjs/common';

import { DepartmentController } from './department.controller.js';
import { DepartmentService } from './department.service.js';
import { DesignationController } from './designation.controller.js';
import { DesignationService } from './designation.service.js';
import { LocationController } from './location.controller.js';
import { LocationService } from './location.service.js';

/**
 * The three masters an employee points at (REQ-A-01, REQ-A-02).
 *
 * One module rather than three: they are created and edited together on the
 * same setup screens, and splitting them would give three modules with one
 * controller each and nothing to say to one another. They are exported because
 * shifts, holiday calendars and period locks are all per-location.
 */
@Module({
  controllers: [DepartmentController, DesignationController, LocationController],
  providers: [DepartmentService, DesignationService, LocationService],
  exports: [DepartmentService, DesignationService, LocationService],
})
export class OrgModule {}
