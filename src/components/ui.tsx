import type { ComponentProps } from "react";

// Small building blocks shared by every demo, styled with Tailwind utilities.
// Pages compose these instead of reaching for global CSS classes.

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

const buttonStyles = {
  primary: "bg-accent font-semibold text-white hover:brightness-110",
  ghost: "border border-line bg-transparent font-medium text-accent-ink hover:bg-code",
} as const;

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button
      className={cx("cursor-pointer rounded-md px-3.5 py-1.5 disabled:cursor-not-allowed disabled:opacity-50", buttonStyles[variant], className)}
      {...props}
    />
  );
}

// The framed area a demo runs in.
// Callers set the height (h-70, h-95…).
export function Stage({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("relative mb-3 overflow-hidden rounded-xl border border-line bg-bg", className)} {...props} />;
}
