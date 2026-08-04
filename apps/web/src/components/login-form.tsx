import * as React from "react"
import { Clock } from "lucide-react"

import { useAppConfig } from "@/lib/app-config"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * The registry's login-05 composition, wired to the session. Two deliberate
 * departures from the block: a password field (the API authenticates
 * email+password, not magic links) and no social buttons or sign-up link —
 * accounts are created by HR, never self-served.
 */
export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  const { login } = useSession()
  const { branding } = useAppConfig()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const result = login(email, password)
    if (!result.ok) setError(result.error ?? "Sign-in failed.")
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={submit}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            {branding.logoDataUrl ? (
              <img
                src={branding.logoDataUrl}
                alt=""
                className="size-10 rounded-md object-contain"
              />
            ) : (
              <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
                <Clock className="size-5" />
              </div>
            )}
            <h1 className="text-xl font-bold">Welcome to {branding.companyName}</h1>
            <FieldDescription>
              Punch, apply for leave and see your payslips. Accounts are created by HR.
            </FieldDescription>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="login-email">Email</FieldLabel>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="login-password">Password</FieldLabel>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <FieldDescription>Locked for 15 minutes after 5 failed attempts.</FieldDescription>
          </Field>
          <Field>
            <Button type="submit">Sign in</Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  )
}
