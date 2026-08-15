import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "group/toggle relative inline-flex pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 items-center justify-center gap-1 rounded-none text-xs font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted data-[state=on]:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-muted",
      },
      /*
       * The same 44px floor the Button primitive takes, for the same reason:
       * the `::after` growth here is `-inset-y-*` too, so a short label like
       * "7d" came out 36 wide and 44 tall and the vertical-only growth never
       * reached the narrow side. `min-w-*` already exists per size; this is the
       * coarse-pointer value of it.
       */
      size: {
        default:
          "h-8 pointer-coarse:after:-inset-y-[7px] min-w-8 pointer-coarse:min-w-11 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 pointer-coarse:after:-inset-y-[9px] min-w-7 pointer-coarse:min-w-11 rounded-none px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-9 pointer-coarse:after:-inset-y-[5px] min-w-9 pointer-coarse:min-w-11 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
