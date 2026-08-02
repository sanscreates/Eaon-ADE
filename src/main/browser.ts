import net from 'node:net'

/**
 * Ports a dev server is likely to be sitting on.
 *
 * The preview panel exists mostly to look at the thing you are building, and
 * the address of that thing is nearly always one of these. Probing beats making
 * someone remember whether this project came up on 5173 or 3000.
 */
const CANDIDATES = [
  3000, 3001, 3333, 4000, 4200, 5000, 5173, 5174, 8000, 8080, 8081, 8788, 9000
]

/**
 * Servers that answer on a dev port but are not what anyone means by one.
 *
 * macOS runs AirPlay Receiver on 5000 out of the box, and it speaks HTTP, so a
 * plain "is the port open?" check reports it as a dev server on every Mac. A
 * chip that opens Apple's AirPlay endpoint is worse than no chip.
 */
const NOT_A_DEV_SERVER = /^server:\s*(airtunes|airplay)/im

/**
 * True if something on this loopback port answers HTTP like a web server.
 *
 * A TCP handshake alone is not enough: plenty of things listen on these ports
 * without serving pages, and the panel can only usefully open a page.
 */
function isWebServer(port: number, timeout = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    let head = ''

    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }

    socket.setTimeout(timeout)
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))

    socket.once('connect', () => {
      socket.write(`HEAD / HTTP/1.0\r\nHost: localhost:${port}\r\n\r\n`)
    })

    socket.on('data', (chunk) => {
      head += chunk.toString('latin1')
      // The status line and headers are all that matter, and they arrive first.
      if (head.length < 512 && !head.includes('\r\n\r\n')) return
      finish(head.startsWith('HTTP/') && !NOT_A_DEV_SERVER.test(head))
    })

    // Loopback only. This never reaches beyond the machine it runs on.
    socket.connect(port, '127.0.0.1')
  })
}

/** Which of the usual dev-server ports are serving pages right now. */
export async function devPorts(): Promise<number[]> {
  const results = await Promise.all(
    CANDIDATES.map(async (port) => ((await isWebServer(port)) ? port : 0))
  )
  return results.filter((p): p is number => p > 0)
}
