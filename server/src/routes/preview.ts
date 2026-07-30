import { Router } from 'express';
import net from 'node:net';

export const previewRouter = Router();

const SELF_PORT = Number(process.env.PORT ?? 8787);

/* The ports a dev server actually lands on, ordered by how often you meet
   them — the first hit is what the browser panel offers first. Scanning is
   the whole point of the panel: nobody should have to alt-tab to a terminal
   to find out which port Vite grabbed this time. */
const CANDIDATE_PORTS = [
  3000, 5173, 3001, 8080, 4200, 8000, 5174, 4321, 5000, 3002, 4000, 4173, 1234,
  6006, 8081, 8100, 9000, 1313, 3333, 7357, 19006,
];

const HOST = '127.0.0.1';

/** A TCP connect is the cheapest honest answer to "is anything listening?". */
function isOpen(port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: HOST });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Best-effort page title, so the list reads "Vite + React" rather than a wall
 * of port numbers. Anything slow, non-HTML or oversized is simply skipped —
 * a missing title costs nothing, a hung scan costs the whole panel.
 */
async function titleOf(port: number, timeoutMs = 700): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${HOST}:${port}/`, {
      signal: controller.signal,
      headers: { accept: 'text/html' },
    });
    if (!res.ok) return undefined;
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return undefined;
    if (Number(res.headers.get('content-length') ?? 0) > 2_000_000) return undefined;
    const html = await res.text();
    const match = html.slice(0, 8192).match(/<title[^>]*>([^<]{1,90})<\/title>/i);
    return match?.[1].trim() || undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

previewRouter.get('/servers', async (_req, res) => {
  const ports = CANDIDATE_PORTS.filter((p) => p !== SELF_PORT);
  const open = (await Promise.all(ports.map(async (p) => ((await isOpen(p)) ? p : null))))
    .filter((p): p is number => p !== null);

  const servers = await Promise.all(
    open.map(async (port) => ({
      port,
      url: `http://localhost:${port}`,
      title: await titleOf(port),
    })),
  );

  res.json({ servers });
});
