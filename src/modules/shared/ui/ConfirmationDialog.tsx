import React, { useEffect, useRef } from 'react';

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: string;
  details: Array<{ label: string; value: string }>;
  confirmLabel: string;
  busy?: boolean;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

// A small, accessible confirmation surface for consequential Workspc actions.
// It deliberately owns no domain state: callers supply the reviewed facts and
// retain authority over the mutation, result message and refresh behavior.
export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  open,
  title,
  description,
  details,
  confirmLabel,
  busy = false,
  tone = 'primary',
  onConfirm,
  onCancel,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;
  const confirmClass = tone === 'danger'
    ? 'bg-rose-700 hover:bg-rose-800'
    : 'bg-blue-600 hover:bg-blue-700';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        aria-describedby="confirmation-dialog-description"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
      >
        <h2 id="confirmation-dialog-title" className="text-lg font-bold text-slate-900">{title}</h2>
        <p id="confirmation-dialog-description" className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
        <dl className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3">
          {details.map(detail => (
            <div key={detail.label} className="grid grid-cols-[7rem_1fr] gap-2 text-xs">
              <dt className="font-bold text-slate-500">{detail.label}</dt>
              <dd className="break-words text-slate-800">{detail.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300 ${confirmClass}`}>
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
        <p className="sr-only" aria-live="polite">{busy ? `${confirmLabel} is in progress.` : ''}</p>
      </section>
    </div>
  );
};
