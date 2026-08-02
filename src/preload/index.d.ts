import type { EaonApi } from './index'

declare global {
  interface Window {
    eaon: EaonApi
  }
}

export {}
