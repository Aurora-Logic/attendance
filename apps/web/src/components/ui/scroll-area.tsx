"use client"

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        // max-h-[inherit] is what makes `<ScrollArea className="max-h-80">`
        // mean anything. `size-full` is height:100%, and a percentage height
        // resolves against the parent's height -- which is auto here, because
        // the root was given a max-height and not a height. The percentage
        // therefore resolved to auto, the viewport grew to its content, and the
        // content escaped the root instead of scrolling inside it: the column
        // chooser rendered seventeen checkboxes straight out of the bottom of
        // its own popover. Inheriting the max-height gives the viewport a
        // ceiling to scroll against, and inherits `none` when the caller set no
        // ceiling, so a ScrollArea sized by its parent is unaffected.
        className="size-full max-h-[inherit] rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none data-horizontal:h-1.5 data-horizontal:flex-col data-vertical:h-full data-vertical:w-1.5",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="bg-foreground/20 hover:bg-foreground/35 relative flex-1 rounded-full transition-colors"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
