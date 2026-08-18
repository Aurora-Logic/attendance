import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  PERMISSIONS,
  companyListQuerySchema,
  contactDuplicateQuerySchema,
  contactListQuerySchema,
  createCompanySchema,
  createContactSchema,
  linkCompanyPartySchema,
  updateCompanySchema,
  updateContactSchema,
  type CompanyView,
  type ContactDuplicate,
  type ContactView,
  type Paginated,
} from '@vyuha/shared';

import { createZodDto } from '../../../platform/common/zod-validation.pipe.js';
import { CurrentUser, type Principal } from '../../../platform/rbac/principal.js';
import { RequirePermission } from '../../../platform/rbac/route-policy.js';
import { CrmService } from './crm.service.js';

class ContactListQueryDto extends createZodDto(contactListQuerySchema) {}
class ContactDuplicateQueryDto extends createZodDto(contactDuplicateQuerySchema) {}
class CreateContactDto extends createZodDto(createContactSchema) {}
class UpdateContactDto extends createZodDto(updateContactSchema) {}
class CompanyListQueryDto extends createZodDto(companyListQuerySchema) {}
class CreateCompanyDto extends createZodDto(createCompanySchema) {}
class UpdateCompanyDto extends createZodDto(updateCompanySchema) {}
class LinkCompanyPartyDto extends createZodDto(linkCompanyPartySchema) {}

/**
 * `/api/v1/crm/contacts` and `/api/v1/crm/companies` (09 §5). The guard keeps
 * out an account holding neither breadth; `CrmService` narrows what a holder
 * actually sees through `ScopeService`.
 */
@Controller('crm/contacts')
export class ContactController {
  constructor(private readonly crm: CrmService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CRM_CONTACT_VIEW_SELF, PERMISSIONS.CRM_CONTACT_VIEW_ALL)
  list(@CurrentUser() principal: Principal, @Query() query: ContactListQueryDto): Promise<Paginated<ContactView>> {
    return this.crm.listContacts(principal, query);
  }

  /** REQ-U-08. Declared before `:id` so the literal segment is not read as one. */
  @Get('duplicates')
  @RequirePermission(PERMISSIONS.CRM_CONTACT_MANAGE)
  duplicates(
    @CurrentUser() principal: Principal,
    @Query() query: ContactDuplicateQueryDto,
  ): Promise<ContactDuplicate[]> {
    return this.crm.contactDuplicates(principal, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.CRM_CONTACT_VIEW_SELF, PERMISSIONS.CRM_CONTACT_VIEW_ALL)
  find(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<ContactView> {
    return this.crm.findContact(principal, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.CRM_CONTACT_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() principal: Principal, @Body() body: CreateContactDto): Promise<ContactView> {
    return this.crm.createContact(principal, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CRM_CONTACT_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateContactDto,
  ): Promise<ContactView> {
    return this.crm.updateContact(principal, id, body);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.CRM_CONTACT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.crm.deleteContact(principal, id);
  }
}

@Controller('crm/companies')
export class CompanyController {
  constructor(private readonly crm: CrmService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CRM_CONTACT_VIEW_SELF, PERMISSIONS.CRM_CONTACT_VIEW_ALL)
  list(@CurrentUser() principal: Principal, @Query() query: CompanyListQueryDto): Promise<Paginated<CompanyView>> {
    return this.crm.listCompanies(principal, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.CRM_CONTACT_VIEW_SELF, PERMISSIONS.CRM_CONTACT_VIEW_ALL)
  find(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<CompanyView> {
    return this.crm.findCompany(principal, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.CRM_CONTACT_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() principal: Principal, @Body() body: CreateCompanyDto): Promise<CompanyView> {
    return this.crm.createCompany(principal, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CRM_CONTACT_MANAGE)
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCompanyDto,
  ): Promise<CompanyView> {
    return this.crm.updateCompany(principal, id, body);
  }

  /** REQ-U-03: link (or unlink, with null) the Tally party this company became. */
  @Put(':id/party')
  @RequirePermission(PERMISSIONS.CRM_CONTACT_MANAGE)
  linkParty(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LinkCompanyPartyDto,
  ): Promise<CompanyView> {
    return this.crm.linkParty(principal, id, body);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.CRM_CONTACT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.crm.deleteCompany(principal, id);
  }
}
