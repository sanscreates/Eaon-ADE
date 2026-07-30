type MessageHandler = (msg: Record<string, unknown>) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private queue: string[] = [];
  private reconnectDelay = 800;
  private started = false;

  connected = false;

  connect(): void {
    if (this.started) return;
    this.started = true;
    this.open();
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 800;
      for (const queued of this.queue) ws.send(queued);
      this.queue = [];
      this.emit({ t: '__open' });
    };

    ws.onmessage = (event) => {
      try {
        this.emit(JSON.parse(String(event.data)));
      } catch {
        // malformed frame; ignore
      }
    };

    ws.onclose = () => {
      this.connected = false;
      this.emit({ t: '__close' });
      setTimeout(() => this.open(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 5000);
    };

    ws.onerror = () => ws.close();
  }

  private emit(msg: Record<string, unknown>): void {
    for (const handler of this.handlers) handler(msg);
  }

  send(msg: Record<string, unknown>): void {
    const raw = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
    } else {
      this.queue.push(raw);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export const wsClient = new WSClient();
