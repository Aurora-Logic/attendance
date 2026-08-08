import * as React from "react"
import { Navigate, Route, Routes } from "react-router"

import { useSession } from "@/lib/session"
import { AppLayout } from "@/components/app-layout"
import { Spinner } from "@/components/ui/spinner"
import { DashboardPage } from "@/routes/dashboard"
import { LoginPage } from "@/routes/login"
import { PunchPage } from "@/routes/punch"

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
  name: keyof T
) => React.lazy(() => loader().then((module) => ({ default: module[name] })))

const ApprovalsPage = lazyRoute(() => import("@/routes/approvals"), "ApprovalsPage")
const AttendancePage = lazyRoute(() => import("@/routes/attendance"), "AttendancePage")
const AuditPage = lazyRoute(() => import("@/routes/audit"), "AuditPage")
const EmployeeDetailPage = lazyRoute(() => import("@/routes/employee-detail"), "EmployeeDetailPage")
const EmployeesPage = lazyRoute(() => import("@/routes/employees"), "EmployeesPage")
const LeavePage = lazyRoute(() => import("@/routes/leave"), "LeavePage")
const ItemsPage = lazyRoute(() => import("@/routes/items"), "ItemsPage")
const PayrollPage = lazyRoute(() => import("@/routes/payroll"), "PayrollPage")
const PlaceholderPage = lazyRoute(() => import("@/routes/placeholder"), "PlaceholderPage")
const ProcurementAnalyticsPage = lazyRoute(
  () => import("@/routes/procurement-analytics"),
  "ProcurementAnalyticsPage"
)
const PurchaseOrderDetailPage = lazyRoute(
  () => import("@/routes/purchase-order-detail"),
  "PurchaseOrderDetailPage"
)
const PurchaseOrderNewPage = lazyRoute(
  () => import("@/routes/purchase-order-new"),
  "PurchaseOrderNewPage"
)
const PurchaseOrdersPage = lazyRoute(() => import("@/routes/purchase-orders"), "PurchaseOrdersPage")
const CustomersPage = lazyRoute(() => import("@/routes/customers"), "CustomersPage")
const EstimateDetailPage = lazyRoute(() => import("@/routes/estimate-detail"), "EstimateDetailPage")
const EstimateNewPage = lazyRoute(() => import("@/routes/estimate-new"), "EstimateNewPage")
const EstimatesPage = lazyRoute(() => import("@/routes/estimates"), "EstimatesPage")
const SalesOrderDetailPage = lazyRoute(
  () => import("@/routes/sales-order-detail"),
  "SalesOrderDetailPage"
)
const SalesOrdersPage = lazyRoute(() => import("@/routes/sales-orders"), "SalesOrdersPage")
const ReportsPage = lazyRoute(() => import("@/routes/reports"), "ReportsPage")
const RolesPage = lazyRoute(() => import("@/routes/roles"), "RolesPage")
const RosterPage = lazyRoute(() => import("@/routes/roster"), "RosterPage")
const SettingsPage = lazyRoute(() => import("@/routes/settings"), "SettingsPage")
const StockPage = lazyRoute(() => import("@/routes/stock"), "StockPage")
const ExpensesPage = lazyRoute(() => import("@/routes/expenses"), "ExpensesPage")
const IndentsPage = lazyRoute(() => import("@/routes/indents"), "IndentsPage")
const InvoiceDetailPage = lazyRoute(() => import("@/routes/invoice-detail"), "InvoiceDetailPage")
const InvoicesPage = lazyRoute(() => import("@/routes/invoices"), "InvoicesPage")
const PayablesPage = lazyRoute(() => import("@/routes/payables"), "PayablesPage")
const ReceivablesPage = lazyRoute(() => import("@/routes/receivables"), "ReceivablesPage")
const VendorBillsPage = lazyRoute(() => import("@/routes/vendor-bills"), "VendorBillsPage")
const VendorsPage = lazyRoute(() => import("@/routes/vendors"), "VendorsPage")

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
  )
}

export default function App() {
  const { user } = useSession()

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  return (
    <React.Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="punch" element={<PunchPage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="roster" element={<RosterPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="employees/:id" element={<EmployeeDetailPage />} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="estimates" element={<EstimatesPage />} />
          <Route path="estimates/new" element={<EstimateNewPage />} />
          <Route path="estimates/:id" element={<EstimateDetailPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="sales-orders" element={<SalesOrdersPage />} />
          <Route path="sales-orders/:id" element={<SalesOrderDetailPage />} />
          <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
          <Route path="purchase-orders/new" element={<PurchaseOrderNewPage />} />
          <Route path="purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
          <Route path="vendors" element={<VendorsPage />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="receivables" element={<ReceivablesPage />} />
          <Route path="indents" element={<IndentsPage />} />
          <Route path="vendor-bills" element={<VendorBillsPage />} />
          <Route path="payables" element={<PayablesPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="procurement-analytics" element={<ProcurementAnalyticsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="payroll" element={<PayrollPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<PlaceholderPage />} />
        </Route>
      </Routes>
    </React.Suspense>
  )
}
