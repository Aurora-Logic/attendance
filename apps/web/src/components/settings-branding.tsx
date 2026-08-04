import * as React from "react"
import { toast } from "sonner"
import { Clock, ImageUp, ShieldAlert, Trash2 } from "lucide-react"

import { useAppConfig } from "@/lib/app-config"
import { useSession } from "@/lib/session"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const MAX_LOGO_BYTES = 200_000

/**
 * White-label branding — admin only. The gate is the config.manage scope
 * (only ADMIN holds it at ALL), not a role name, so it stays consistent with
 * every other permission in the app.
 */
export function BrandingSettings() {
  const { branding, setBranding } = useAppConfig()
  const { scopeFor } = useSession()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const canEdit = scopeFor("config.manage") === "ALL"

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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader>
          <CardTitle>White label</CardTitle>
          <CardDescription>
            Name and logo appear on the sidebar, the login screen and, later, payslip PDFs and
            report headers.
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
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  id="brand-logo"
                  type="file"
                  accept="image/*"
                  className="hidden"
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
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>How the sidebar header renders</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  )
}
