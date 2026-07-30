import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cls } from '../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════════
   A dropdown that cannot be clipped.

   An absolutely-positioned menu is trapped by the nearest scrolling ancestor,
   and several of ours live inside one — a board column scrolls its cards, the
   tab strip scrolls its tabs. Worse, a kanban column is 178px wide while the
   menu has a 196px minimum, so it is *guaranteed* to overflow its own column
   and get cut in half. No z-index fixes that; overflow clipping ignores it.

   So the menu renders into <body> and positions itself from the trigger's
   rect: right-aligned like the CSS version was, flipped above when there is
   no room below, and pulled back inside the window if either edge would run
   off. It closes on scroll rather than chasing the anchor, which is what a
   native menu does too.
   ═══════════════════════════════════════════════════════════════════════════ */

const GAP = 6;
const EDGE = 8;

interface Props {
  /** The element the menu hangs off — usually the button that opened it. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Which side to try first; it flips anyway when space runs out. */
  prefer?: 'below' | 'above';
}

export function PortalMenu({ anchorRef, open, onClose, children, className, prefer = 'below' }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);

  // Measure after paint but before the browser shows it: the menu is rendered
  // hidden at first precisely so its real height is known before placement.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const a = anchor.getBoundingClientRect();
      const m = menu.getBoundingClientRect();

      const roomBelow = window.innerHeight - a.bottom - GAP - EDGE;
      const roomAbove = a.top - GAP - EDGE;
      const up =
        prefer === 'above'
          ? m.height <= roomAbove || roomAbove > roomBelow
          : m.height > roomBelow && roomAbove > roomBelow;

      const top = up ? a.bottom - a.height - m.height - GAP : a.bottom + GAP;
      const left = a.right - m.width;

      setPos({
        top: Math.max(EDGE, Math.min(top, window.innerHeight - m.height - EDGE)),
        left: Math.max(EDGE, Math.min(left, window.innerWidth - m.width - EDGE)),
        up,
      });
    };
    place();
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, prefer, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The trigger toggles on its own click; treating it as "outside" here
      // would close and reopen in the same gesture.
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Capture: the scroll happens on an inner container, which does not bubble.
    const onScroll = () => onClose();

    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={cls('dropdown', 'dropdown-fixed', className)}
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        transformOrigin: pos?.up ? 'bottom right' : 'top right',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
