import './lib/nestify-host'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { getNestifyApi } from './lib/ipc'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import './index.css'

const rootElement = document.getElementById('root')

function reportRendererEvent(
  event: string,
  payload: unknown,
  details?: unknown,
  level: 'warn' | 'error' = 'error',
): void {
  const value = payload instanceof Error
    ? { name: payload.name, message: payload.message, stack: payload.stack, details }
    : payload
  void getNestifyApi()?.logEvent?.(event, value, level).catch(() => undefined)
}

function reportRendererError(event: string, error: unknown, details?: unknown): void {
  reportRendererEvent(event, error, details)
}

function renderStartupError(error: unknown, title = 'Nestify 界面启动失败'): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  if (!rootElement) return
  rootElement.innerHTML = ''
  const container = document.createElement('main')
  container.style.cssText =
    'box-sizing:border-box;min-height:100vh;padding:32px;font:14px/1.5 system-ui,sans-serif;'
  const heading = document.createElement('h1')
  heading.textContent = title
  heading.style.cssText = 'max-width:900px;margin:0 auto 16px;font-size:22px;font-weight:600;'
  const details = document.createElement('pre')
  details.textContent = message
  details.style.cssText =
    'max-width:900px;margin:0 auto;white-space:pre-wrap;padding:16px;border:1px solid currentColor;border-radius:6px;'
  container.append(heading, details)
  rootElement.append(container)
}

class RendererErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: unknown }
> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[Nestify] renderer component failed', error, info.componentStack)
    reportRendererError('renderer.component.failed', error, { componentStack: info.componentStack })
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return <RendererErrorView error={this.state.error} />
    }
    return this.props.children
  }
}

function RendererErrorView({ error }: { error: unknown }): React.ReactElement {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  return (
    <main className="min-h-screen p-8">
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Nestify 界面运行失败</AlertTitle>
        <AlertDescription>
          <pre className="whitespace-pre-wrap break-all">{message}</pre>
        </AlertDescription>
      </Alert>
    </main>
  )
}

function isNonFatalBrowserLayoutNotice(event: ErrorEvent): boolean {
  const message = event.message || (event.error instanceof Error ? event.error.message : '')
  return /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i.test(message)
}

window.addEventListener('error', (event) => {
  if (isNonFatalBrowserLayoutNotice(event)) {
    console.warn('[Nestify] ignored non-fatal browser layout notice', event.message)
    reportRendererError('renderer.layout.notice', event.error ?? event.message, { message: event.message }, 'warn')
    return
  }
  console.error('[Nestify] renderer uncaught error', event.error ?? event.message)
  reportRendererError('renderer.uncaught.error', event.error ?? event.message, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  })
  renderStartupError(event.error ?? event.message, 'Nestify 页面运行失败')
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Nestify] renderer unhandled rejection', event.reason)
  reportRendererError('renderer.unhandled.rejection', event.reason)
  renderStartupError(event.reason, 'Nestify 页面异步操作失败')
})

try {
  if (!rootElement) throw new Error('Renderer root element #root is missing')
  reportRendererEvent('renderer.main.start', {
    userAgent: navigator.userAgent,
    language: navigator.language,
  })
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RendererErrorBoundary>
        <App />
      </RendererErrorBoundary>
    </React.StrictMode>,
  )
  requestAnimationFrame(() => {
    reportRendererEvent('renderer.main.loaded')
  })
} catch (error) {
  console.error('[Nestify] renderer startup failed', error)
  reportRendererError('renderer.startup.failed', error)
  renderStartupError(error)
}
