import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';

import { AppShell } from '@/app/layout/app-shell';
import { SessionGate } from '@/app/session-gate';
import { EmployeeDetailPage, EmployeesPage } from '@/features/employees';
import { ApprovalsPage } from '@/features/approvals';
import { MyAttendancePage, TeamAttendancePage } from '@/features/attendance';
import { HolidaysPage } from '@/features/holidays';
import { LeaveTypesPage, MyLeavePage, TeamLeavePage } from '@/features/leave';
import { PatternsPage } from '@/features/patterns/patterns-page';
import { PunchPage } from '@/features/punch';
import { ShiftsPage } from '@/features/shifts';
import { AnalyticsPage } from '@/features/analytics';
import { AuditLogPage } from '@/features/audit';
import { DownloadsPage } from '@/features/downloads';
import { IntegrationsPage } from '@/features/integrations';
import { PeriodLockPage } from '@/features/period-lock';
import { RecycleBinPage } from '@/features/recycle-bin';
import { ReportsPage } from '@/features/reports';
import { LandingPage } from '@/features/dashboard/landing';
import { ReportsDashboardPage } from '@/features/reports/reports-dashboard-page';
import { AdministrationScreen } from '@/features/administration/administration-screen';
import { RolesPage } from '@/features/roles';
import { SettingsPage } from '@/features/settings';
import { NotificationsPage } from '@/features/notifications';
import { CompaniesPage } from '@/features/crm/companies-page';
import { ContactsPage } from '@/features/crm/contacts-page';
import { DealsPage } from '@/features/crm/deals-page';
import { EstimatesPage } from '@/features/sales/estimates-page';
import { EstimateEditorPage } from '@/features/sales/estimate-editor-page';
import { DocumentPrintPage } from '@/features/documents/print-page';
import { SalesOrdersPage } from '@/features/sales/sales-orders-page';
import { DispatchPaperPage } from '@/features/sales/dispatch-paper-page';
import { PackingSlipPage } from '@/features/sales/packing-slip-page';
import { SalesOrderEditorPage } from '@/features/sales/sales-order-editor-page';
import { InvoicesPage } from '@/features/sales/invoices-page';
import { InvoiceEditorPage } from '@/features/sales/invoice-editor-page';
import { PickQueuePage } from '@/features/sales/pick-queue-page';
import { AwaitingInvoicePage } from '@/features/sales/awaiting-invoice-page';
import { DispatchesPage } from '@/features/sales/dispatches-page';
import { ScanPage } from '@/features/sales/scan-page';
import { PackedPage } from '@/features/sales/packed-page';
import { RequirementsPage } from '@/features/purchase/requirements-page';
import { GrnPaperPage } from '@/features/purchase/grn-paper-page';
import { PurchaseOrderEditorPage } from '@/features/purchase/purchase-order-editor-page';
import { PurchaseOrdersPage } from '@/features/purchase/purchase-orders-page';
import { GrnsPage } from '@/features/purchase/grns-page';
import { PartiesPage } from '@/features/masters/parties-page';
import { TasksPage } from '@/features/tasks/tasks-page';
import { PriceListPage } from '@/features/pricing/price-list-page';
import { PriceListsPage } from '@/features/pricing/price-lists-page';
import { StockItemsPage } from '@/features/masters/stock-items-page';
import { StockItemPage } from '@/features/masters/item-page';
import { PartyPage } from '@/features/masters/party-page';
import { DuplicatesPage } from '@/features/masters/duplicates-page';
import { VouchersPage } from '@/features/masters/vouchers-page';
import { VoucherPaperPage } from '@/features/masters/voucher-paper-page';
import { PlaceholderPage } from '@/features/placeholder/placeholder-page';
import { OrgMastersPage } from '@/features/org-masters';
import { ProfilePage } from '@/features/profile/profile-page';
import { UpdatesPage } from '@/features/updates';
import { ShortcutProvider } from '@/lib/keyboard/registry';
import { ALL_NAV_ITEMS } from '@/lib/nav';

/**
 * Routes with a screen of their own. Everything else in the navigation falls
 * through to the placeholder, so the two lists cannot both claim a path — the
 * filter below is driven by this set rather than by a second hand-written list
 * that would go stale the next time a screen ships.
 */
const BUILT_ROUTES = new Set([
  '/sales/estimates',
  '/sales/orders',
  '/sales/invoices',
  '/sales/pick-queue',
  '/sales/awaiting-invoice',
  '/sales/dispatches',
  '/purchase/requirements',
  '/purchase/orders',
  '/purchase/grns',
  '/tasks',
  '/crm/deals',
  '/crm/contacts',
  '/crm/companies',
  '/masters/parties',
  '/masters/items',
  '/masters/price-lists',
  '/masters/vouchers',
  '/',
  '/employees',
  '/punch',
  '/my-attendance',
  '/team-attendance',
  '/shifts',
  '/my-leave',
  '/approvals',
  '/leave-types',
  '/holidays',
  '/settings',
  '/roles',
  '/integrations',
  '/audit',
  '/period-lock',
  '/reports',
  '/downloads',
  '/recycle-bin',
  '/organisation',
  '/analytics',
  '/team-leave',
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // An operations tool is read constantly; refetching a muster on every
      // window focus would be a lot of noise for little freshness.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionGate>
        <ShortcutProvider>
          <Routes>
            {/* The paper and nothing else: printed from its own tab, outside the shell (REQ-W-01, print and PDF). */}
            <Route path="print/:kind/:id" element={<DocumentPrintPage />} />

            <Route element={<AppShell />}>
              <Route index element={<LandingPage />} />

              <Route path="employees" element={<EmployeesPage />} />
              <Route path="employees/:id" element={<EmployeeDetailPage />} />

              <Route path="punch" element={<PunchPage />} />
              <Route path="my-leave" element={<MyLeavePage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="leave-types" element={<LeaveTypesPage />} />
              <Route path="holidays" element={<HolidaysPage />} />
              <Route path="my-attendance" element={<MyAttendancePage />} />
              <Route path="team-attendance" element={<TeamAttendancePage />} />
              <Route path="shifts" element={<ShiftsPage />} />

              <Route path="settings" element={<SettingsPage />} />
              <Route path="roles" element={<RolesPage />} />
              <Route path="integrations" element={<IntegrationsPage />} />
              <Route path="masters/parties" element={<PartiesPage />} />
              <Route path="masters/parties/:id" element={<PartyPage />} />
              <Route path="masters/items" element={<StockItemsPage />} />
              <Route path="masters/items/:id" element={<StockItemPage />} />
              <Route path="masters/price-lists" element={<PriceListsPage />} />
              <Route path="masters/price-lists/new" element={<PriceListPage />} />
              <Route path="masters/price-lists/:id" element={<PriceListPage />} />
              <Route path="masters/duplicates" element={<DuplicatesPage />} />
              <Route path="masters/vouchers" element={<VouchersPage />} />
              <Route path="masters/vouchers/:id" element={<VouchersPage />} />
              <Route path="masters/vouchers/:id/paper" element={<VoucherPaperPage />} />
              <Route path="crm/contacts" element={<ContactsPage />} />
              <Route path="crm/contacts/:id" element={<ContactsPage />} />
              <Route path="crm/companies" element={<CompaniesPage />} />
              <Route path="crm/companies/:id" element={<CompaniesPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="tasks/:id" element={<TasksPage />} />
              <Route path="crm/deals" element={<DealsPage />} />
              <Route path="crm/deals/:id" element={<DealsPage />} />
              <Route path="sales/estimates" element={<EstimatesPage />} />
              <Route path="sales/estimates/new" element={<EstimateEditorPage />} />
              <Route path="sales/estimates/:id" element={<EstimateEditorPage />} />
              <Route path="sales/orders" element={<SalesOrdersPage />} />
              <Route path="sales/orders/new" element={<SalesOrderEditorPage />} />
              <Route path="sales/orders/:id" element={<SalesOrderEditorPage />} />
              <Route path="sales/invoices" element={<InvoicesPage />} />
              <Route path="sales/invoices/:id" element={<InvoiceEditorPage />} />
              <Route path="sales/pick-queue" element={<PickQueuePage />} />
              <Route path="sales/pick-queue/:id" element={<PickQueuePage />} />
              <Route path="sales/awaiting-invoice" element={<AwaitingInvoicePage />} />
              <Route path="sales/dispatches" element={<DispatchesPage />} />
              <Route path="sales/delivered" element={<DispatchesPage stage="delivered" />} />
              <Route path="sales/dispatches/:id" element={<DispatchPaperPage />} />
              <Route path="sales/scan" element={<ScanPage />} />
              <Route path="sales/packed" element={<PackedPage />} />
              <Route path="sales/packs/:id" element={<PackingSlipPage />} />
              <Route path="purchase/requirements" element={<RequirementsPage />} />
              <Route path="purchase/orders" element={<PurchaseOrdersPage />} />
              <Route path="purchase/orders/new" element={<PurchaseOrderEditorPage />} />
              <Route path="purchase/orders/:id" element={<PurchaseOrderEditorPage />} />
              <Route path="purchase/grns" element={<GrnsPage />} />
              <Route path="purchase/grns/:id" element={<GrnPaperPage />} />
              <Route path="audit" element={<AuditLogPage />} />
              <Route path="period-lock" element={<PeriodLockPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="reports/dashboard" element={<ReportsDashboardPage />} />
              <Route path="administration" element={<AdministrationScreen />} />
              <Route path="downloads" element={<DownloadsPage />} />
              <Route path="recycle-bin" element={<RecycleBinPage />} />
              <Route path="organisation" element={<OrgMastersPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="team-leave" element={<TeamLeavePage />} />

              {/* Off the sidebar on purpose: reached from the user menu, not
                  from the navigation groups the PRD fixes (§6.1). */}
              <Route path="profile" element={<ProfilePage />} />

              {/* Also off the sidebar, and for the same reason. */}
              <Route path="updates" element={<UpdatesPage />} />

              {/* And this one: reached from the bell in the header (REQ-K-05). */}
              <Route path="notifications" element={<NotificationsPage />} />

              {/* Sample data lives on this route, so it is never built into
                  a production bundle (CLAUDE.md §6). */}
              {import.meta.env.DEV ? (
                <Route path="patterns" element={<PatternsPage />} />
              ) : null}

              {ALL_NAV_ITEMS.filter((item) => !BUILT_ROUTES.has(item.to)).map((item) => (
                <Route key={item.to} path={item.to.slice(1)} element={<PlaceholderPage />} />
              ))}

              <Route path="*" element={<PlaceholderPage />} />
            </Route>
          </Routes>
        </ShortcutProvider>
        </SessionGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
