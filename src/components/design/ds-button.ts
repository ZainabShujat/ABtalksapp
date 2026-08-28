import { cva, type VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Orange CTA for light surfaces (dashboard hub, program dashboard).
 * Overrides shadcn `default` hover, which uses `--primary` (purple).
 * Apply on `<Link>` / `<a>` via className — never `<Button asChild>`.
 *
 * Tokens: fill `#E05226`, hover `#C9411C`, active `#A93617` (docs/design-system.md §14).
 */
export const dsButtonVariants = cva(
  cn(
    buttonVariants({ variant: "default" }),
    "rounded-lg border-transparent bg-[#E05226] font-semibold text-white shadow-none",
    "transition-colors duration-200 ease-[var(--ease-spark)]",
    "hover:scale-100 hover:!bg-[#C9411C] hover:!text-white hover:shadow-none",
    "active:scale-100 active:!bg-[#A93617]",
    "[a]:hover:!bg-[#C9411C] [a]:hover:!text-white",
    "focus-visible:border-[#E05226] focus-visible:ring-2 focus-visible:ring-[#E05226] focus-visible:ring-offset-4",
  ),
  {
    variants: {
      size: {
        sm: "h-9 px-4 text-sm",
        default: "h-10 px-4 text-sm",
        lg: "h-12 px-4 text-sm",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

export type DsButtonVariants = VariantProps<typeof dsButtonVariants>;
