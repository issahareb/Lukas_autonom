import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        /*
         * Ohne Rahmen. Ein 1px-Strich um jeden Knopf war der zweite grosse
         * Teil des Terminal-Eindrucks: acht umrandete Kaesten nebeneinander
         * lesen sich wie eine Werkzeugleiste aus den Neunzigern.
         * Unterschieden wird jetzt ueber die FLAECHE — gefuellt heisst "das
         * ist die Hauptsache hier", aufgehellt heisst "auch moeglich".
         */
        default: "bg-primary text-primary-foreground",
        destructive: "bg-destructive/15 text-red-300 hover:bg-destructive/25",
        outline: "bg-white/[0.06] hover:bg-white/[0.1]",
        secondary: "bg-secondary text-secondary-foreground",
        ghost: "hover:bg-white/[0.06]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // @replit changed sizes
        default: "min-h-10 px-5 py-2",
        sm: "min-h-9 px-4 text-xs",
        lg: "min-h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
