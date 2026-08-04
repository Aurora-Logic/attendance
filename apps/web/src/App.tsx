import { Navigate, Route, Routes } from "react-router"

import { useSession } from "@/lib/session"
import { AppLayout } from "@/components/app-layout"
import { ApprovalsPage } from "@/routes/approvals"
import { AttendancePage } from "@/routes/attendance"
import { AuditPage } from "@/routes/audit"
import { DashboardPage } from "@/routes/dashboard"
import { EmployeeDetailPage } from "@/routes/employee-detail"
import { EmployeesPage } from "@/routes/employees"
import { LeavePage } from "@/routes/leave"
import { LoginPage } from "@/routes/login"
import { ItemsPage } from "@/routes/items"
import { PayrollPage } from "@/routes/payroll"
import { PlaceholderPage } from "@/routes/placeholder"
import { ProcurementAnalyticsPage } from "@/routes/procurement-analytics"
import { PunchPage } from "@/routes/punch"
import { PurchaseOrderDetailPage } from "@/routes/purchase-order-detail"
import { PurchaseOrderNewPage } from "@/routes/purchase-order-new"
import { PurchaseOrdersPage } from "@/routes/purchase-orders"
import { ReportsPage } from "@/routes/reports"
import { RolesPage } from "@/routes/roles"
import { RosterPage } from "@/routes/roster"
import { SettingsPage } from "@/routes/settings"
import { VendorsPage } from "@/routes/vendors"

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
        <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="purchase-orders/new" element={<PurchaseOrderNewPage />} />
        <Route path="purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
        <Route path="vendors" element={<VendorsPage />} />
        <Route path="items" element={<ItemsPage />} />
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
  )
}
