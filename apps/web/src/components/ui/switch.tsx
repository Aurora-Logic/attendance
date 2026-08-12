"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        // ring-1 rather than ring-0: the thumb is bg-background and the
        // unchecked track is --input, which measured a contrast ratio of 1.04
        // against each other — a white knob on a near-white track, invisible
        // until the switch is turned on. The ring is what makes an off switch
        // read as a switch at all.
        //
        // The coarse-pointer size is not decoration either. The track grows to
        // 48x28 on touch while the thumb stayed 16px, which left it adrift in a
        // larger pill and broke the travel: the checked transform moves the
        // thumb by its own width, so a thumb that does not grow with the track
        // stops short of the right edge instead of landing on it.
        className="pointer-events-none block rounded-full bg-background ring-1 ring-foreground/40 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 pointer-coarse:group-data-[size=default]/switch:size-6 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] dark:data-checked:bg-primary-foreground group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
