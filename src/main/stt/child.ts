/**
 * The transcriber, running in its own process.
 *
 * Whisper holds the CPU for as long as it takes to decode an utterance. If that
 * ran in the main process, every keystroke in every terminal would stall behind
 * it, so the model lives out here and talks over a message port.
 *
 * The network is switched off before a model is loaded: `allowRemoteModels` is
 * false and every load is `local_files_only`. If a file is missing, this fails
 * loudly rather than quietly fetching it from the internet.
 */

interface LoadReq {
  id: number
  kind: 'load'
  repo: string
  root: string
  encoderDtype: string
  decoderDtype: string
}
interface TranscribeReq {
  id: number
  kind: 'transcribe'
  audio: Float32Array
  multilingual: boolean
  language: string
}
interface UnloadReq {
  id: number
  kind: 'unload'
}
type Req = LoadReq | TranscribeReq | UnloadReq

interface ParentPort {
  on: (channel: 'message', cb: (e: { data: Req }) => void) => void
  postMessage: (value: unknown) => void
}
const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort

/* eslint-disable @typescript-eslint/no-explicit-any */
let asr: any = null
let loadedRepo = ''

async function ensure(req: LoadReq): Promise<void> {
  if (asr && loadedRepo === req.repo) return

  const { pipeline, env } = (await import('@huggingface/transformers')) as any

  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = req.root
  // Nothing should ever be written next to the models we manage ourselves.
  env.useBrowserCache = false

  if (asr) {
    try {
      await asr.dispose?.()
    } catch {
      /* replacing a model must not fail because the old one would not let go */
    }
    asr = null
    loadedRepo = ''
  }

  asr = await pipeline('automatic-speech-recognition', req.repo, {
    dtype: { encoder_model: req.encoderDtype, decoder_model_merged: req.decoderDtype },
    device: 'cpu',
    local_files_only: true
  })
  loadedRepo = req.repo
}

parentPort.on('message', (e) => {
  const req = e.data
  void (async () => {
    try {
      if (req.kind === 'load') {
        await ensure(req)
        parentPort.postMessage({ id: req.id, ok: true })
        return
      }

      if (req.kind === 'unload') {
        try {
          await asr?.dispose?.()
        } catch {
          /* nothing useful to do if it will not unload */
        }
        asr = null
        loadedRepo = ''
        parentPort.postMessage({ id: req.id, ok: true })
        return
      }

      if (!asr) throw new Error('No speech model is loaded')

      // English-only Whisper models reject `language` and `task` outright, so
      // the options have to differ by model rather than always being passed.
      const opts =
        req.multilingual && req.language && req.language !== 'auto'
          ? { language: req.language, task: 'transcribe' }
          : req.multilingual
            ? { task: 'transcribe' }
            : {}

      const started = Date.now()
      const out = await asr(req.audio, opts)
      parentPort.postMessage({
        id: req.id,
        ok: true,
        text: String(out?.text ?? ''),
        ms: Date.now() - started
      })
    } catch (err) {
      parentPort.postMessage({
        id: req.id,
        ok: false,
        error: String(err instanceof Error ? err.message : err)
      })
    }
  })()
})
