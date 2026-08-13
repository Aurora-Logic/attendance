export { OrgMastersPage } from './org-masters-page';
/**
 * The delete every other master list uses. It lives in this feature because
 * these three masters are its most obvious readers, but the route it calls is
 * one route for all seven soft-deletable kinds (REQ-B-09a).
 */
export { DeleteMasterDialog, type DeleteTarget } from './delete-master-dialog';
export { MASTER_LABEL, MASTER_MANAGE_PERMISSION, useDeleteMaster } from './use-master-delete';
