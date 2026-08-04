"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      // Classic-Toast presentation: coloured variants + a close button. The
      // old `toast` component is gone from the registry (deprecated upstream);
      // sonner is its successor, so the look is configured here — tinted from
      // OUR status tokens, not sonner's stock palette, so both themes match
      // the rest of the app.
      richColors
      closeButton
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--success-bg": "color-mix(in oklch, var(--status-present) 12%, var(--popover))",
          "--success-text": "var(--status-present)",
          "--success-border": "color-mix(in oklch, var(--status-present) 35%, var(--border))",
          "--warning-bg": "color-mix(in oklch, var(--status-half-day) 14%, var(--popover))",
          "--warning-text": "var(--warning-foreground)",
          "--warning-border": "color-mix(in oklch, var(--status-half-day) 40%, var(--border))",
          "--error-bg": "color-mix(in oklch, var(--destructive) 12%, var(--popover))",
          "--error-text": "var(--destructive)",
          "--error-border": "color-mix(in oklch, var(--destructive) 35%, var(--border))",
          "--info-bg": "color-mix(in oklch, var(--status-wfh) 12%, var(--popover))",
          "--info-text": "var(--status-wfh)",
          "--info-border": "color-mix(in oklch, var(--status-wfh) 35%, var(--border))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
