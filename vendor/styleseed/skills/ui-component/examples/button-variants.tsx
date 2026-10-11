import React, { forwardRef } from "react";
import { motion, HTMLMotionProps } from "framer-motion";
import { Loader2, Plus, ArrowRight, Trash2, Settings } from "lucide-react";

// Types & Interfaces
export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  children?: React.ReactNode;
}

// Spring physics configuration for tactile feedback
const springTransition = {
  type: "spring",
  stiffness: 400,
  damping: 25,
};

// Variant class mappings adhering to WCAG 2.1 AA 4.5:1 contrast
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-600 focus-visible:ring-indigo-500",
  secondary:
    "bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 focus-visible:ring-slate-400",
  ghost:
    "bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 focus-visible:ring-slate-400",
  destructive:
    "bg-red-600 text-white hover:bg-red-700 active:bg-red-800 dark:bg-red-500 dark:hover:bg-red-600 focus-visible:ring-red-500",
  outline:
    "bg-transparent text-slate-800 border border-slate-300 hover:bg-slate-50 active:bg-slate-100 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800 focus-visible:ring-indigo-500",
};

// Size scale following 8pt spatial grid
const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-base gap-2.5 rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      isDisabled = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      children,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const isEffectivelyDisabled = isDisabled || disabled || isLoading;

    return (
      <motion.button
        ref={ref}
        disabled={isEffectivelyDisabled}
        whileHover={isEffectivelyDisabled ? undefined : { scale: 1.02 }}
        whileTap={isEffectivelyDisabled ? undefined : { scale: 0.97 }}
        transition={springTransition}
        data-slot="button"
        aria-busy={isLoading}
        className={`inline-flex items-center justify-center font-medium transition-colors select-none
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
          disabled:pointer-events-none disabled:opacity-50
          ${variantClasses[variant]}
          ${sizeClasses[size]}
          ${fullWidth ? "w-full" : ""}
          ${className}`}
        {...props}
      >
        {isLoading ? (
          <Loader2
            className="animate-spin shrink-0 text-current"
            size={size === "sm" ? 14 : size === "md" ? 16 : 18}
            aria-hidden="true"
          />
        ) : (
          leftIcon
        )}

        <span>{children}</span>

        {!isLoading && rightIcon}
      </motion.button>
    );
  }
);

Button.displayName = "Button";

// Example Showcase Component for documentation/testing
export default function ButtonVariantsExample() {
  const [loadingState, setLoadingState] = React.useState(false);

  const toggleLoading = () => {
    setLoadingState(true);
    setTimeout(() => setLoadingState(false), 2000);
  };

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
      <header>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Button Variants & Interaction States
        </h2>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Accessible, spring-animated button primitives with micro-interactions.
        </p>
      </header>

      {/* Main Variants */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Variants
        </h3>
        <div className="flex flex-wrap gap-4 items-center">
          <Button variant="primary">Primary Action</Button>
          <Button variant="secondary">Secondary Action</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost Action</Button>
          <Button variant="destructive" leftIcon={<Trash2 size={16} />}>
            Delete Item
          </Button>
        </div>
      </section>

      {/* Sizes */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Sizes & Icons
        </h3>
        <div className="flex flex-wrap gap-4 items-center">
          <Button size="sm" leftIcon={<Plus size={14} />}>
            Small Add
          </Button>
          <Button size="md" rightIcon={<ArrowRight size={16} />}>
            Medium Next
          </Button>
          <Button size="lg" leftIcon={<Settings size={18} />}>
            Large Settings
          </Button>
        </div>
      </section>

      {/* States */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Interactive States
        </h3>
        <div className="flex flex-wrap gap-4 items-center">
          <Button isLoading variant="primary">
            Loading...
          </Button>
          <Button isDisabled variant="secondary">
            Disabled
          </Button>
          <Button
            variant="primary"
            isLoading={loadingState}
            onClick={toggleLoading}
          >
            Click to Simulate Async
          </Button>
        </div>
      </section>
    </div>
  );
}
