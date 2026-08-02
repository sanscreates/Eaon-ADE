/*
 * Microphone capture, running on the audio thread.
 *
 * This is a real file rather than a generated blob: the renderer's
 * Content-Security-Policy is `script-src 'self'`, and a worklet module is a
 * script like any other — a blob: URL is refused outright. Shipping it as a
 * static asset keeps it same-origin in both development and a packaged build,
 * so the policy does not have to be loosened to make dictation work.
 *
 * It batches raw frames into ~1024-sample blocks so the UI thread gets about
 * fifteen messages a second instead of a hundred and twenty-five.
 */
class AdeCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(1024)
    this.n = 0
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i += 1) {
      this.buf[this.n] = ch[i]
      this.n += 1
      if (this.n === this.buf.length) {
        // slice() copies: the buffer is reused on the next block.
        this.port.postMessage(this.buf.slice(0))
        this.n = 0
      }
    }
    return true
  }
}

registerProcessor('ade-capture', AdeCapture)
