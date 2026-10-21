import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { AppProvider } from './context.js'
import { AppErrorBoundary } from './error-boundary.js'
import './styles.css'
import './ui/ui.css'

const root = document.getElementById('root')
if (!root) throw new Error('root missing')
createRoot(root).render(
  <StrictMode>
    <AppProvider>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </AppProvider>
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined)
}
