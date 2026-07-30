import { useUi } from '../../store/ui';
import { cls } from '../../lib/utils';

/**
 * One reusable yes/no dialog for every destructive or interruptive action:
 * closing a live pane, deleting a card, wiping preferences. Lives in the ui
 * store so any call site can `askConfirm(...)` without threading props.
 */
export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm);
  const closeConfirm = useUi((s) => s.closeConfirm);

  if (!confirm) return null;

  return (
    <div className="modal-overlay" onMouseDown={closeConfirm}>
      <div
        className="modal confirm-modal"
        role="alertdialog"
        aria-label={confirm.title}
        style={{ width: 400 }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            closeConfirm();
          }
          if (e.key === 'Enter') {
            e.stopPropagation();
            closeConfirm();
            confirm.onConfirm();
          }
        }}
      >
        <div className="modal-body confirm-body">
          <div className="confirm-title">{confirm.title}</div>
          {confirm.body && <div className="confirm-text">{confirm.body}</div>}
          <div className="confirm-actions">
            <button className="btn" onClick={closeConfirm} autoFocus>
              Cancel
            </button>
            <button
              className={cls('btn', confirm.danger ? 'btn-danger' : 'btn-accent')}
              onClick={() => {
                closeConfirm();
                confirm.onConfirm();
              }}
            >
              {confirm.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
