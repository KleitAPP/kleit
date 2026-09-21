import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { t } from "@/i18n/en";

/**
 * Bottom sheet (Add, Create, Publish, Send, Report, Sign-up — design pack §3.3, §8.2).
 * Grabber, one heading, one main action in the thumb zone. Closes on Back/Escape and
 * on a tap outside, and leaves the screen underneath visible behind the scrim.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  action,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-slow" />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90dvh] max-w-xl overflow-y-auto rounded-t-md bg-surface px-4 pb-[max(env(safe-area-inset-bottom),var(--kl-space-4))] pt-2 text-ink shadow-sheet data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom duration-slow"
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-pill bg-line" />
          <Dialog.Title className="font-display text-2xl text-ink">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-1 text-sm text-ink-soft">{description}</Dialog.Description>
          ) : null}
          <div className="mt-4">{children}</div>
          {action ? <div className="mt-4">{action}</div> : null}
          <Dialog.Close className="sr-only">{t("sheet.close")}</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The one main action of a sheet or screen: full width, 48 dp, the accent colour. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-12 w-full rounded-pill bg-brand px-5 text-base font-medium text-brand-ink transition-opacity duration-fast hover:opacity-90 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
