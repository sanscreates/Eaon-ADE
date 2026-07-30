import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cls } from '../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════════
   Right-click menus — the only route to anything destructive.

   Nothing in the app deletes on a single click any more. A project, session,
   pane, tab, card or seat is removed by right-clicking it, reading what the
   menu says it will do, and confirming. That costs two extra gestures on a
   rare action and removes a whole class of "I clicked the wrong ✕" — a fair
   trade, and the reason no ✕ is rendered anywhere near destroyable content.

   Positioning follows PortalMenu's rule (render into <body> so no scrolling
   ancestor can clip it), but anchors to the cursor rather than an element:
   a context menu belongs where the pointer is, flipping back inside the
   window when it would otherwise run off an edge.
   ═══════════════════════════════════════════════════════════════════════════ */

const EDGE = 8;

export interface MenuPoint {
  x: number;
  y: number;
}

/**
 * State for one right-clickable thing. Spread `onContextMenu` onto whatever
 * the user should be able to right-click, and render `<ContextMenu>` with
 * `point`/`close` when it is open.
 */
export function useContextMenu() {
  const [point, setPoint] = useState<MenuPoint | null>(null);

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    // Nested targets each have their own menu — a session row inside a
    // worktree inside a project. The innermost one wins, which is the one
    // the pointer is actually over.
    e.stopPropagation();
    setPoint({ x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => setPoint(null), []);

  return { point, open: point !== null, close, onContextMenu };
}

interface Props {
  point: MenuPoint | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function ContextMenu({ point, onClose, children, className }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);

  // Measured while hidden, so the real height is known before it is placed —
  // otherwise a menu near the bottom edge flips a frame late and visibly jumps.
  useLayoutEffect(() => {
    if (!point) {
      setPos(null);
      return;
    }
    const menu = menuRef.current;
    if (!menu) return;
    const m = menu.getBoundingClientRect();

    const up = point.y + m.height + EDGE > window.innerHeight && point.y - m.height - EDGE > 0;
    const top = up ? point.y - m.height : point.y;
    const left = point.x + m.width + EDGE > window.innerWidth ? point.x - m.width : point.x;

    setPos({
      top: Math.max(EDGE, Math.min(top, window.innerHeight - m.height - EDGE)),
      left: Math.max(EDGE, Math.min(left, window.innerWidth - m.width - EDGE)),
      up,
    });
  }, [point]);

  useEffect(() => {
    if (!point) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Capture, because the scroll that moves the thing under the menu happens
    // on an inner container and never reaches window on its own.
    const onScroll = () => onClose();

    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [point, onClose]);

  if (!point) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={cls('dropdown', 'dropdown-fixed', 'context-menu', className)}
      style={{
        top: pos?.top ?? point.y,
        left: pos?.left ?? point.x,
        visibility: pos ? 'visible' : 'hidden',
        transformOrigin: pos?.up ? 'bottom left' : 'top left',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Names what the menu is acting on, so "Delete" is never ambiguous. */
export function MenuHeader({ children }: { children: ReactNode }) {
  return <div className="context-menu-head">{children}</div>;
}

export function MenuSep() {
  return <div className="dropdown-sep" />;
}

interface ItemProps {
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  /** Red, and always placed last — the destructive end of the menu. */
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

export function MenuItem({ onClick, children, icon, danger, disabled, hint }: ItemProps) {
  return (
    <button
      className={cls('dropdown-item', danger && 'dropdown-item-danger')}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <span className="context-menu-icon">{icon}</span>}
      <span className="context-menu-label">{children}</span>
      {hint && <kbd className="context-menu-hint">{hint}</kbd>}
    </button>
  );
}
