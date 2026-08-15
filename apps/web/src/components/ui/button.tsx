import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-none border border-transparent bg-clip-padding text-xs font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] outline-none select-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /*
       * `min-w-11` on a coarse pointer, beside the `::after` growth.
       *
       * The pseudo-element grows the hit area vertically only
       * (`-inset-y-*`), which is right for a text button: it is already wider
       * than 44. It is wrong for one that renders icon-only on a phone -- a
       * `hidden sm:inline` label leaves the icon in text-size padding, giving
       * 36 wide by 44 tall, and the vertical-only growth never touches the
       * short side. Growing the pseudo horizontally instead would have let
       * neighbouring buttons in a group overlap and steal each other's taps,
       * so the control genuinely becomes 44 wide rather than merely claiming
       * the space. A button with a label is already wider and is unaffected.
       *
       * The icon sizes below need none of this: they use `-inset-[N]`, which
       * is both axes, because they are square to begin with.
       */
      size: {
        default:
          "h-8 gap-1.5 px-2.5 pointer-coarse:min-w-11 pointer-coarse:after:-inset-y-[7px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-none px-2 pointer-coarse:min-w-11 pointer-coarse:after:-inset-y-[11px] text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-none px-2.5 pointer-coarse:min-w-11 pointer-coarse:after:-inset-y-[9px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 pointer-coarse:min-w-11 pointer-coarse:after:-inset-y-[5px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8 pointer-coarse:after:-inset-[7px]",
        "icon-xs": "size-6 rounded-none pointer-coarse:after:-inset-[11px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-none pointer-coarse:after:-inset-[9px]",
        "icon-lg": "size-9 pointer-coarse:after:-inset-[5px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
