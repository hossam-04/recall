import { useEffect, useRef } from "react";

/**
 * A native <dialog>, not a div pretending to be one.
 *
 * showModal() gives focus trapping, Escape to close, inert background content,
 * and the ::backdrop — all behaviours a hand-rolled modal has to reimplement
 * and usually gets wrong for keyboard users. This app is keyboard-driven, so
 * that is not a detail.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // `close` fires for Escape and for the backdrop too, so React state stays
    // in step with what the browser did rather than only with our buttons.
    <dialog ref={ref} onClose={onClose} aria-label={title}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
