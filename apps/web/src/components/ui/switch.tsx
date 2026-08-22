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
        // The tap target is this pseudo-element, not the track. Base UI renders
        // the switch as <span role="switch">, so the coarse-pointer height
        // floor in index.css never matched it — and it should not: a switch is
        // drawn at an intrinsic size, exactly like the checkbox and radio that
        // rule already excludes, and a height floor would stretch it into a
        // capsule rather than enlarge it. The inset is per size because the two
        // tracks start at different heights: 13px takes the 18.4px default to
        // 44.4, and 15px takes the 14px small one to 44. One shared value would
        // have left the smaller switch at 40.
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-[background-color,border-color,box-shadow] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 pointer-coarse:data-[size=default]:after:-inset-y-[13px] pointer-coarse:data-[size=sm]:after:-inset-y-[15px] focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
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
        // The thumb is deliberately half the track's width and nothing else:
        // the checked transform moves it by its own width less the border, so
        // thumb = track / 2 is what makes it sit flush at both ends. An earlier
        // pointer-coarse:size-6 here assumed the track grew on touch. It does
        // not, and a 24px thumb in an 18.4px track bulged past the track on
        // every side and slid clear of it when switched on. Touch is handled by
        // the hit area on the root instead.
        className="pointer-events-none block rounded-full bg-background ring-1 ring-foreground/40 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)] dark:data-checked:bg-primary-foreground group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
