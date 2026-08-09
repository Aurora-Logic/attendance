import * as React from "react";
import { Navigate, Route, Routes } from "react-router";

import { useSession } from "@/lib/session";
import { AppLayout } from "@/components/app-layout";
import { RequirePermission } from "@/components/require-permission";
import { Spinner } from "@/components/ui/spinner";
import { DashboardPage } from "@/routes/dashboard";
import { LoginPage } from "@/routes/login";
import { PunchPage } from "@/routes/punch";

/**
 * Route-level code splitting. Only the two screens someone actually lands on —
 * the dashboard and the punch kiosk (the PWA's start_url) — are in the entry
 * chunk; every other route is fetched when it is first visited. Statically
 * importing all 35 routes put recharts, the whole procurement suite and every
 * table into one 1.6MB parse before the first paint, on phones that open one
 * screen and never touch the rest.
 */
const lazyRoute = <T extends Record<string, React.ComponentType>>(
  loader: () => Promise<T>,
  name: keyof T,
) => React.lazy(() => loader().then((module) => ({ default: module[name] })));

const ApprovalsPage = lazyRoute(
  () => import("@/routes/approvals"),
  "ApprovalsPage",
);
const AttendancePage = lazyRoute(
  () => import("@/routes/attendance"),
  "AttendancePage",
);
const AuditPage = lazyRoute(() => import("@/routes/audit"), "AuditPage");
const EmployeeDetailPage = lazyRoute(
  () => import("@/routes/employee-detail"),
  "EmployeeDetailPage",
);
const EmployeesPage = lazyRoute(
  () => import("@/routes/employees"),
  "EmployeesPage",
);
const LeavePage = lazyRoute(() => import("@/routes/leave"), "LeavePage");
const ItemsPage = lazyRoute(() => import("@/routes/items"), "ItemsPage");
const PlaceholderPage = lazyRoute(
  () => import("@/routes/placeholder"),
  "PlaceholderPage",
);
const ProcurementAnalyticsPage = lazyRoute(
  () => import("@/routes/procurement-analytics"),
  "ProcurementAnalyticsPage",
);
const PurchaseOrderDetailPage = lazyRoute(
  () => import("@/routes/purchase-order-detail"),
  "PurchaseOrderDetailPage",
);
const PurchaseOrderNewPage = lazyRoute(
  () => import("@/routes/purchase-order-new"),
  "PurchaseOrderNewPage",
);
const PurchaseOrdersPage = lazyRoute(
  () => import("@/routes/purchase-orders"),
  "PurchaseOrdersPage",
);
const CustomersPage = lazyRoute(
  () => import("@/routes/customers"),
  "CustomersPage",
);
const EstimateDetailPage = lazyRoute(
  () => import("@/routes/estimate-detail"),
  "EstimateDetailPage",
);
const EstimateNewPage = lazyRoute(
  () => import("@/routes/estimate-new"),
  "EstimateNewPage",
);
const EstimatesPage = lazyRoute(
  () => import("@/routes/estimates"),
  "EstimatesPage",
);
const SalesOrderDetailPage = lazyRoute(
  () => import("@/routes/sales-order-detail"),
  "SalesOrderDetailPage",
);
const SalesOrdersPage = lazyRoute(
  () => import("@/routes/sales-orders"),
  "SalesOrdersPage",
);
const FulfilmentPage = lazyRoute(
  () => import("@/routes/fulfilment"),
  "FulfilmentPage",
);
const ReportsPage = lazyRoute(() => import("@/routes/reports"), "ReportsPage");
const RolesPage = lazyRoute(() => import("@/routes/roles"), "RolesPage");
const RosterPage = lazyRoute(() => import("@/routes/roster"), "RosterPage");
const SettingsPage = lazyRoute(
  () => import("@/routes/settings"),
  "SettingsPage",
);
const StockPage = lazyRoute(() => import("@/routes/stock"), "StockPage");
const ExpensesPage = lazyRoute(
  () => import("@/routes/expenses"),
  "ExpensesPage",
);
const IndentsPage = lazyRoute(() => import("@/routes/indents"), "IndentsPage");
const InvoiceDetailPage = lazyRoute(
  () => import("@/routes/invoice-detail"),
  "InvoiceDetailPage",
);
const InvoicesPage = lazyRoute(
  () => import("@/routes/invoices"),
  "InvoicesPage",
);
const PayablesPage = lazyRoute(
  () => import("@/routes/payables"),
  "PayablesPage",
);
const ReceivablesPage = lazyRoute(
  () => import("@/routes/receivables"),
  "ReceivablesPage",
);
const VendorBillsPage = lazyRoute(
  () => import("@/routes/vendor-bills"),
  "VendorBillsPage",
);
const VendorsPage = lazyRoute(() => import("@/routes/vendors"), "VendorsPage");

/**
 * Chunk-load fallback. It sits inside the shell, so the sidebar and header
 * stay put and only the page area changes — a whole-screen spinner would read
 * as a navigation failure on a fast connection where the chunk arrives in
 * 40ms.
 */
function RouteFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Spinner className="text-muted-foreground size-5" />
    </div>
  );
}

export default function App() {
  const { user } = useSession();

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <React.Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="punch" element={
              <RequirePermission permission="punch.self">
                <PunchPage />
              </RequirePermission>
            } />
          <Route path="attendance" element={
              <RequirePermission permission="reports.view">
                <AttendancePage />
              </RequirePermission>
            } />
          <Route
            path="roster"
            element={
              <RequirePermission permission="roster.manage">
                <RosterPage />
              </RequirePermission>
            }
          />
          <Route
            path="approvals"
            element={
              <RequirePermission permission="attendance.approve">
                <ApprovalsPage />
              </RequirePermission>
            }
          />
          <Route
            path="employees"
            element={
              <RequirePermission permission="employee.manage">
                <EmployeesPage />
              </RequirePermission>
            }
          />
          <Route path="employees/:id" element={<EmployeeDetailPage />} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="estimates" element={
              <RequirePermission permission="sales.view">
                <EstimatesPage />
              </RequirePermission>
            } />
          <Route path="estimates/new" element={
              <RequirePermission permission="sales.manage">
                <EstimateNewPage />
              </RequirePermission>
            } />
          <Route path="estimates/:id" element={
              <RequirePermission permission="sales.view">
                <EstimateDetailPage />
              </RequirePermission>
            } />
          <Route path="customers" element={
              <RequirePermission permission="sales.view">
                <CustomersPage />
              </RequirePermission>
            } />
          <Route path="fulfilment" element={
              <RequirePermission permission="dispatch.view">
                <FulfilmentPage />
              </RequirePermission>
            } />
          <Route path="sales-orders" element={
              <RequirePermission permission="sales.view">
                <SalesOrdersPage />
              </RequirePermission>
            } />
          <Route path="sales-orders/:id" element={
              <RequirePermission permission="sales.view">
                <SalesOrderDetailPage />
              </RequirePermission>
            } />
          <Route path="purchase-orders" element={
              <RequirePermission permission="procurement.view">
                <PurchaseOrdersPage />
              </RequirePermission>
            } />
          <Route
            path="purchase-orders/new"
            element={
              <RequirePermission permission="procurement.manage">
                <PurchaseOrderNewPage />
              </RequirePermission>
            }
          />
          <Route
            path="purchase-orders/:id"
            element={
              <RequirePermission permission="procurement.view">
                <PurchaseOrderDetailPage />
              </RequirePermission>
            }
          />
          <Route path="vendors" element={
              <RequirePermission permission="procurement.view">
                <VendorsPage />
              </RequirePermission>
            } />
          <Route path="items" element={
              <RequirePermission permission="procurement.view">
                <ItemsPage />
              </RequirePermission>
            } />
          <Route path="stock" element={
              <RequirePermission permission="procurement.view">
                <StockPage />
              </RequirePermission>
            } />
          <Route path="invoices" element={
              <RequirePermission permission="sales.view">
                <InvoicesPage />
              </RequirePermission>
            } />
          <Route path="invoices/:id" element={
              <RequirePermission permission="sales.view">
                <InvoiceDetailPage />
              </RequirePermission>
            } />
          <Route path="receivables" element={
              <RequirePermission permission="sales.view">
                <ReceivablesPage />
              </RequirePermission>
            } />
          <Route path="indents" element={
              <RequirePermission permission="procurement.view">
                <IndentsPage />
              </RequirePermission>
            } />
          <Route path="vendor-bills" element={
              <RequirePermission permission="procurement.view">
                <VendorBillsPage />
              </RequirePermission>
            } />
          <Route path="payables" element={
              <RequirePermission permission="procurement.view">
                <PayablesPage />
              </RequirePermission>
            } />
          <Route path="expenses" element={
              <RequirePermission permission="expense.claim">
                <ExpensesPage />
              </RequirePermission>
            } />
          <Route
            path="procurement-analytics"
            element={
              <RequirePermission permission="procurement.view">
                <ProcurementAnalyticsPage />
              </RequirePermission>
            }
          />
          <Route
            path="reports"
            element={
              <RequirePermission permission="reports.view">
                <ReportsPage />
              </RequirePermission>
            }
          />
          <Route
            path="roles"
            element={
              <RequirePermission permission="config.manage" requiresFullScope>
                <RolesPage />
              </RequirePermission>
            }
          />
          <Route
            path="settings"
            element={
              <RequirePermission permission="config.manage">
                <SettingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="audit"
            element={
              <RequirePermission permission="audit.view">
                <AuditPage />
              </RequirePermission>
            }
          />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<PlaceholderPage />} />
        </Route>
      </Routes>
    </React.Suspense>
  );
}
