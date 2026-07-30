import { useEffect, useState } from 'react';
import { useUi, type Toast } from '../store/ui';
import { cls } from '../lib/utils';
import { IconX } from './Icons';

/** Must match --t-exit in styles.css. */
const EXIT_MS = 140;

type Item = Toast & { closing: boolean };

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  // The store drops a toast the moment it expires, but the element has to
  // outlive that by one exit animation. `items` is the store list plus
  // whatever is still on its way out, each holding its original slot.
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    setItems((prev) => {
      const live = new Map(toasts.map((t) => [t.id, t]));
      const next: Item[] = prev.map((item) => {
        const fresh = live.get(item.id);
        return fresh ? { ...fresh, closing: false } : { ...item, closing: true };
      });
      for (const t of toasts) {
        if (!next.some((item) => item.id === t.id)) next.push({ ...t, closing: false });
      }
      return next;
    });
  }, [toasts]);

  useEffect(() => {
    const closing = items.filter((item) => item.closing).map((item) => item.id);
    if (closing.length === 0) return;
    const handle = window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => !closing.includes(item.id)));
    }, EXIT_MS);
    return () => window.clearTimeout(handle);
  }, [items]);

  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={cls('toast', `toast-${t.kind}`)}
          data-state={t.closing ? 'closed' : 'open'}
        >
          <span className="toast-text">{t.text}</span>
          <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <IconX size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
