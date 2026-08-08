import { useSales } from "@/lib/sales"
import { useSession } from "@/lib/session"
import { CreditChaseList } from "@/components/credit-chase-list"
import { PartyLedgerPage } from "@/components/party-ledger"

export function ReceivablesPage() {
  const { customers, invoices, receipts, recordReceipt } = useSales()
  const { can, user } = useSession()

  return (
    <PartyLedgerPage
      title="Receivables"
      description="Who owes what, aged by due date. Receipts allocate oldest-first."
      partyNoun="customer"
      actionLabel="Record receipt"
      parties={customers.map((customer) => ({ id: customer.id, name: customer.name }))}
      docs={invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        partyId: invoice.customerId,
        dueDate: invoice.dueDate,
        status: invoice.status,
        lines: invoice.lines,
      }))}
      payments={receipts}
      canRecord={can("sales.manage")}
      onRecord={(input) => recordReceipt(input, user?.email ?? "")}
      /* The chase list sits above the ledger: the ageing table says who owes
         what, this says who to ring first. */
      banner={<CreditChaseList />}
    />
  )
}
