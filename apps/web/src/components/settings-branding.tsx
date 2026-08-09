import * as React from "react"
import { toast } from "sonner"
import { Clock, ImageUp, ShieldAlert, Trash2 } from "lucide-react"

import { ApiUnreachable, apiFetch } from "@/lib/api"
import { useAppConfig } from "@/lib/app-config"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const MAX_LOGO_BYTES = 200_000

/**
 * White-label branding — admin only. The gate is the config.manage scope
 * (only ADMIN holds it at ALL), not a role name, so it stays consistent with
 * every other permission in the app.
 */
export function BrandingSettings() {
  const { branding, setBranding } = useAppConfig()
  const { scopeFor, user } = useSession()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const canEdit = scopeFor("config.manage") === "ALL"

  const save = async () => {
    if (user?.source !== "api") {
      toast.success("Branding saved", { description: "Stored locally (demo session)." })
      return
    }
    try {
      // The server stores the white-label identity (name + logo); the print
      // fields ride along locally until the document service lands.
      await apiFetch("/branding", {
        method: "PUT",
        body: JSON.stringify({
          companyName: branding.companyName,
          logoDataUrl: branding.logoDataUrl,
        }),
      })
      toast.success("Branding saved to the server", {
        description: "Login screen and /auth/me now serve it.",
      })
    } catch (error) {
      toast.error(
        error instanceof ApiUnreachable ? "API unreachable — saved locally only" : String(error)
      )
    }
  }

  const [draggingLogo, setDraggingLogo] = React.useState(false)

  const onLogoPicked = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file.")
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo must be under 200 KB", {
        description: "Export a small PNG/SVG — it renders at 32 px in the sidebar.",
      })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setBranding((prev) => ({ ...prev, logoDataUrl: String(reader.result) }))
      toast.success("Logo updated")
    }
    reader.readAsDataURL(file)
  }

  if (!canEdit) {
    return (
      <Alert>
        <ShieldAlert />
        <AlertTitle>Admin only</AlertTitle>
        <AlertDescription>
          White-labelling (company name and logo) requires the config.manage permission at full
          scope, which only the Admin role holds.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader>
          <CardTitle>White label</CardTitle>
          <CardDescription>
            Name and logo appear on the sidebar, the login screen and printed documents. Address,
            GSTIN and contact print on the PO masthead (and later estimates, invoices and
            payslips).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="brand-name">Company name</FieldLabel>
              <Input
                id="brand-name"
                value={branding.companyName}
                onChange={(event) =>
                  setBranding((prev) => ({ ...prev, companyName: event.target.value }))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="brand-branch">Branch label</FieldLabel>
              <Input
                id="brand-branch"
                value={branding.branchLabel}
                onChange={(event) =>
                  setBranding((prev) => ({ ...prev, branchLabel: event.target.value }))
                }
              />
              <FieldDescription>The line under the company name.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="brand-logo">Logo</FieldLabel>
              {/*
                Rule 1.1: a visually-hidden input behind a shadcn Button, in a
                drop target. `sr-only` rather than `hidden` on purpose —
                `display:none` takes the input out of the accessibility tree, so
                a screen reader never learns there is a file field at all.
              */}
              <div
                onDragOver={(event) => {
                  event.preventDefault()
                  setDraggingLogo(true)
                }}
                onDragLeave={() => setDraggingLogo(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDraggingLogo(false)
                  onLogoPicked(event.dataTransfer.files?.[0])
                }}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-dashed p-3 transition-colors",
                  draggingLogo ? "border-primary bg-primary/5" : "border-input"
                )}
              >
                <input
                  ref={fileRef}
                  id="brand-logo"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => onLogoPicked(event.target.files?.[0])}
                />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <ImageUp />
                  Upload logo
                </Button>
                {branding.logoDataUrl ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBranding((prev) => ({ ...prev, logoDataUrl: null }))}
                  >
                    <Trash2 />
                    Remove
                  </Button>
                ) : null}
              </div>
              <FieldDescription>
                PNG or SVG under 200 KB. Stored as a data URL now; object storage in Phase 3.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="brand-address">Registered address</FieldLabel>
              <Textarea
                id="brand-address"
                rows={2}
                value={branding.address}
                placeholder="Plot 14, MIDC Industrial Area, Andheri East, Mumbai 400093"
                onChange={(event) =>
                  setBranding((prev) => ({ ...prev, address: event.target.value }))
                }
              />
              <FieldDescription>Printed under the company name on documents.</FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="brand-gstin">GSTIN</FieldLabel>
                <Input
                  id="brand-gstin"
                  value={branding.gstin}
                  placeholder="27AAACD1234E1ZP"
                  onChange={(event) =>
                    setBranding((prev) => ({ ...prev, gstin: event.target.value.toUpperCase() }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="brand-phone">Phone</FieldLabel>
                <Input
                  id="brand-phone"
                  value={branding.phone}
                  placeholder="+91 22 4000 1234"
                  onChange={(event) =>
                    setBranding((prev) => ({ ...prev, phone: event.target.value }))
                  }
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="brand-email">Email</FieldLabel>
              <Input
                id="brand-email"
                type="email"
                value={branding.email}
                placeholder="purchase@company.in"
                onChange={(event) =>
                  setBranding((prev) => ({ ...prev, email: event.target.value }))
                }
              />
              <FieldDescription>Shown on document mastheads next to the phone.</FieldDescription>
            </Field>
          </FieldGroup>
          <div className="mt-4">
            <Button size="sm" onClick={() => void save()}>
              Save branding
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>Sidebar header, and how the PO masthead prints</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="bg-sidebar flex items-center gap-2 rounded-lg border p-2">
            {branding.logoDataUrl ? (
              <img src={branding.logoDataUrl} alt="" className="size-8 rounded-lg object-contain" />
            ) : (
              <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
                <Clock className="size-4" />
              </div>
            )}
            <div className="grid text-left text-sm leading-tight">
              <span className="truncate font-medium">{branding.companyName || "Company"}</span>
              <span className="text-muted-foreground truncate text-xs">
                {branding.branchLabel || "Branch"}
              </span>
            </div>
          </div>
          {/* Deliberately untokened white — this is paper, like the PO sheet. */}
          <div className="rounded border border-neutral-300 bg-white p-3 text-neutral-900">
            {branding.logoDataUrl ? (
              <img src={branding.logoDataUrl} alt="" className="mb-1 h-6 w-auto" />
            ) : null}
            <p className="text-sm font-bold tracking-tight">
              {branding.companyName || "Company"}
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-neutral-500">
              {branding.address || branding.branchLabel}
              {branding.gstin ? (
                <>
                  <br />
                  GSTIN{" "}
                  <span className="font-mono font-semibold text-neutral-800">{branding.gstin}</span>
                </>
              ) : null}
              {branding.phone || branding.email ? (
                <>
                  <br />
                  {[branding.phone, branding.email].filter(Boolean).join(" · ")}
                </>
              ) : null}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
