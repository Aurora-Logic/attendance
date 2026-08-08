
import { DEMO_ACCOUNTS, ROLE_LABEL, demoPasswordFor, useSession } from "@/lib/session"
import { LoginForm } from "@/components/login-form"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"

/** login-05 page shell: muted backdrop, centred narrow column. */
export function LoginPage() {
  const { login } = useSession()

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardDescription>Demo accounts — click to sign straight in</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="hover:bg-muted flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors"
              onClick={() => void login(account.email, demoPasswordFor(account.email))}
            >
              <span className="truncate">{account.email}</span>
              <Badge variant="outline">{ROLE_LABEL[account.role]}</Badge>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
