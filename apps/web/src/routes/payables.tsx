import { useProcurement } from "@/lib/procurement"
import { useSession } from "@/lib/session"
import { PartyLedgerPage } from "@/components/party-ledger"

export function PayablesPage() {
  const { vendors, vendorBills, payments, recordPayment } = useProcurement()
  const { can, user } = useSession()

  return (
    <PartyLedgerPage
      title="Payables"
      description="What we owe vendors, aged by due date. Payments allocate oldest-first."
      partyNoun="vendor"
      actionLabel="Record payment"
      parties={vendors.map((vendor) => ({ id: vendor.id, name: vendor.name }))}
      docs={vendorBills.map((bill) => ({
        id: bill.id,
        number: bill.billNo,
        partyId: bill.vendorId,
        dueDate: bill.dueDate,
        status: bill.status,
        lines: bill.lines,
      }))}
      payments={payments}
      canRecord={can("procurement.manage")}
      onRecord={(input) => recordPayment(input, user?.email ?? "")}
    />
  )
}
