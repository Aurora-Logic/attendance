import { Route, Routes } from "react-router"

import { AppLayout } from "@/components/app-layout"
import { ApprovalsPage } from "@/routes/approvals"
import { AttendancePage } from "@/routes/attendance"
import { AuditPage } from "@/routes/audit"
import { DashboardPage } from "@/routes/dashboard"
import { EmployeeDetailPage } from "@/routes/employee-detail"
import { EmployeesPage } from "@/routes/employees"
import { LeavePage } from "@/routes/leave"
import { PayrollPage } from "@/routes/payroll"
import { PlaceholderPage } from "@/routes/placeholder"
import { PunchPage } from "@/routes/punch"
import { ReportsPage } from "@/routes/reports"
import { RolesPage } from "@/routes/roles"
import { RosterPage } from "@/routes/roster"
import { SettingsPage } from "@/routes/settings"

export default function App() {
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
        <Route path="reports" element={<ReportsPage />} />
        <Route path="payroll" element={<PayrollPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<PlaceholderPage />} />
      </Route>
    </Routes>
  )
}
