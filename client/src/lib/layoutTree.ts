import { uid } from './utils';

export interface LeafNode {
  kind: 'leaf';
  id: string;
  sessionId: string | null;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  dir: 'row' | 'column';
  sizes: number[];
  children: LayoutNode[];
}

export type LayoutNode = LeafNode | SplitNode;

export const MAX_PANES = 16;

export function makeLeaf(sessionId: string | null = null): LeafNode {
  return { kind: 'leaf', id: uid(), sessionId };
}

export function leaves(root: LayoutNode | null): LeafNode[] {
  if (!root) return [];
  if (root.kind === 'leaf') return [root];
  return root.children.flatMap((c) => leaves(c));
}

export function leafCount(root: LayoutNode | null): number {
  return leaves(root).length;
}

export function findLeaf(root: LayoutNode | null, leafId: string): LeafNode | null {
  return leaves(root).find((l) => l.id === leafId) ?? null;
}

export function leafBySession(root: LayoutNode | null, sessionId: string): LeafNode | null {
  return leaves(root).find((l) => l.sessionId === sessionId) ?? null;
}

export function splitLeaf(root: LayoutNode, leafId: string, dir: 'row' | 'column', newLeaf: LeafNode): LayoutNode {
  if (root.kind === 'leaf') {
    if (root.id !== leafId) return root;
    return {
      kind: 'split',
      id: uid(),
      dir,
      sizes: [50, 50],
      children: [{ ...root }, newLeaf],
    };
  }
  return {
    ...root,
    children: root.children.map((c) => splitLeaf(c, leafId, dir, newLeaf)),
  };
}

export function assignSession(root: LayoutNode, leafId: string, sessionId: string | null): LayoutNode {
  if (root.kind === 'leaf') {
    return root.id === leafId ? { ...root, sessionId } : root;
  }
  return { ...root, children: root.children.map((c) => assignSession(c, leafId, sessionId)) };
}

export function setSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (root.kind === 'leaf') return root;
  if (root.id === splitId) return { ...root, sizes };
  return { ...root, children: root.children.map((c) => setSizes(c, splitId, sizes)) };
}

export function removeLeaf(root: LayoutNode, leafId: string): LayoutNode | null {
  if (root.kind === 'leaf') {
    return root.id === leafId ? null : root;
  }
  const children: LayoutNode[] = [];
  const keptSizes: number[] = [];
  for (let i = 0; i < root.children.length; i++) {
    const child = removeLeaf(root.children[i], leafId);
    if (child !== null) {
      children.push(child);
      keptSizes.push(root.sizes[i] ?? 100 / root.children.length);
    }
  }
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const total = keptSizes.reduce((a, b) => a + b, 0) || 1;
  return { ...root, children, sizes: keptSizes.map((s) => (s / total) * 100) };
}

/**
 * Prune leaves whose session no longer exists; returns (possibly null) root.
 *
 * Returns `root` itself when nothing was pruned. That identity matters: this
 * runs on every session change, and rebuilding the node unconditionally both
 * re-rendered every pane and reset hand-dragged split sizes back to equal.
 * When leaves do go, the survivors keep their share proportionally rather
 * than snapping to an even split.
 */
export function pruneSessions(root: LayoutNode | null, aliveIds: Set<string>): LayoutNode | null {
  if (!root) return null;
  if (root.kind === 'leaf') {
    if (root.sessionId === null) return root;
    return aliveIds.has(root.sessionId) ? root : null;
  }
  const children: LayoutNode[] = [];
  const keptSizes: number[] = [];
  let changed = false;
  root.children.forEach((child, i) => {
    const next = pruneSessions(child, aliveIds);
    if (next !== child) changed = true;
    if (next !== null) {
      children.push(next);
      keptSizes.push(root.sizes[i] ?? 100 / root.children.length);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  if (!changed) return root;
  const total = keptSizes.reduce((a, b) => a + b, 0) || 1;
  return { ...root, children, sizes: keptSizes.map((s) => (s / total) * 100) };
}

/** Build a balanced grid with n panes, alternating split direction. */
export function balanced(sessionIds: (string | null)[], dir: 'row' | 'column' = 'row'): LayoutNode {
  if (sessionIds.length === 1) return makeLeaf(sessionIds[0]);
  const half = Math.ceil(sessionIds.length / 2);
  const left = balanced(sessionIds.slice(0, half), dir === 'row' ? 'column' : 'row');
  const right = balanced(sessionIds.slice(half), dir === 'row' ? 'column' : 'row');
  const leftShare = (half / sessionIds.length) * 100;
  return {
    kind: 'split',
    id: uid(),
    dir,
    sizes: [leftShare, 100 - leftShare],
    children: [left, right],
  };
}
