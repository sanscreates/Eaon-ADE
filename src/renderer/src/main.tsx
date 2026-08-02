import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/chrome.css'
import './styles/surfaces.css'
import './styles/grid.css'
import './styles/overlays.css'
import './styles/voice.css'
import './styles/update.css'
import './styles/browser.css'
import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')

// No StrictMode: terminals are imperative, long-lived DOM. Double-mounting
// them in development costs more than it catches.
createRoot(root).render(<App />)
