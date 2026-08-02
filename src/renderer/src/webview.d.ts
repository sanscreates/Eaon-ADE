/**
 * Electron's <webview> is a custom element, so TypeScript needs telling it
 * exists before JSX will accept it. Only the attributes the preview panel
 * actually sets are declared — anything else should go through the element's
 * methods, which are typed where it is used.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: string
        useragent?: string
        /** Never set by this app: the guest gets no bridge into the renderer. */
        preload?: string
      }
    }
  }
}

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
          src?: string
          partition?: string
          allowpopups?: string
          useragent?: string
          preload?: string
        }
      }
    }
  }
}

export {}
