import { formatPaise } from "@attendance/shared"

import { useAppConfig } from "@/lib/app-config"

/**
 * The payslip. Payroll released money and the employee had no document for it
 * — this is that document.
 *
 * It carries the `po-document` class deliberately: that is the app's print
 * isolation hook (see index.css), so Cmd+P prints exactly this sheet on A4 and
 * nothing else. "PDF" on every platform is the browser's Print → Save as PDF,
 * which needs no dependency and always matches what is on screen.
 *
 * Gross only, by decision: statutory components (PF/ESI/PT/TDS) are deferred
 * scope, and a slip that invented deduction lines would be a false record.
 */
export interface PayslipData {
  month: string
  employeeName: string
  employeeCode: string
  department: string
  designation?: string
  payableDays: number
  perDayPaise: number
  earnedPaise: number
  otMinutes: number
  otPaise: number
  grossPaise: number
  bankTail?: string | null
  pan?: string
}

const MONTH_LABEL = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between border-b border-dashed border-neutral-300 py-1.5 ${
        bold ? "font-semibold" : ""
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

export function PayslipSheet({ data }: { data: PayslipData }) {
  const { branding } = useAppConfig()
  const otHours = (data.otMinutes / 60).toFixed(2)

  return (
    <div className="po-document mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] text-neutral-900 shadow-sm">
      <header className="flex items-start justify-between border-b-2 border-neutral-900 pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{branding.companyName}</h1>
          {branding.address ? (
            <p className="mt-0.5 max-w-[80mm] text-[11px] text-neutral-600">{branding.address}</p>
          ) : null}
          {branding.gstin ? (
            <p className="text-[11px] text-neutral-600">GSTIN {branding.gstin}</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold uppercase">Payslip</p>
          <p className="text-[11px] text-neutral-600">{MONTH_LABEL(data.month)}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-x-8 gap-y-1 border-b border-neutral-300 py-3 text-[12px]">
        <div className="flex justify-between">
          <span className="text-neutral-600">Employee</span>
          <span className="font-medium">{data.employeeName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-600">Code</span>
          <span className="font-medium">{data.employeeCode}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-600">Department</span>
          <span className="font-medium">{data.department}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-600">Designation</span>
          <span className="font-medium">{data.designation ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-600">Bank account</span>
          <span className="font-medium">{data.bankTail ?? "Not on record"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-600">PAN</span>
          <span className="font-medium">{data.pan || "—"}</span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-x-10 py-4">
        <div>
          <h2 className="mb-1 border-b border-neutral-900 pb-1 text-[11px] font-semibold uppercase tracking-wide">
            Attendance
          </h2>
          <Row label="Payable days" value={data.payableDays.toFixed(1)} />
          <Row label="Rate per day" value={formatPaise(data.perDayPaise)} />
          <Row label="Approved overtime" value={`${otHours} h`} />
        </div>
        <div>
          <h2 className="mb-1 border-b border-neutral-900 pb-1 text-[11px] font-semibold uppercase tracking-wide">
            Earnings
          </h2>
          <Row label="Earned salary" value={formatPaise(data.earnedPaise)} />
          <Row label="Overtime" value={formatPaise(data.otPaise)} />
          <Row label="Gross payable" value={formatPaise(data.grossPaise)} bold />
        </div>
      </section>

      <section className="border-t-2 border-neutral-900 pt-2">
        <div className="flex items-baseline justify-between text-base font-bold">
          <span>Net payable</span>
          <span className="tabular-nums">{formatPaise(data.grossPaise)}</span>
        </div>
        <p className="mt-1 text-[11px] text-neutral-600">
          Gross equals net for this period — statutory deductions are not configured. Payable days
          are computed from the locked attendance month; this slip cannot be edited, and a
          correction is issued as a new payroll version.
        </p>
      </section>

      <footer className="mt-8 flex items-end justify-between text-[11px] text-neutral-500">
        <span>Computer-generated — valid without signature.</span>
        <span>{branding.companyName}</span>
      </footer>
    </div>
  )
}
