import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const rootElement = document.getElementById('root')

function renderStartupError(error: unknown, title = 'Nestify 界面启动失败'): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  if (!rootElement) return
  rootElement.innerHTML = ''
  const container = document.createElement('main')
  container.style.cssText =
    'box-sizing:border-box;min-height:100vh;padding:32px;color:#f5f5f4;background:#161513;font:14px/1.5 system-ui,sans-serif;'
  const heading = document.createElement('h1')
  heading.textContent = title
  heading.style.cssText = 'max-width:900px;margin:0 auto 16px;font-size:22px;font-weight:600;'
  const details = document.createElement('pre')
  details.textContent = message
  details.style.cssText =
    'max-width:900px;margin:0 auto;white-space:pre-wrap;color:#fca5a5;background:#292524;padding:16px;border-radius:6px;'
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
    <main
      style={{
        boxSizing: 'border-box',
        minHeight: '100vh',
        padding: 32,
        color: '#f5f5f4',
        background: '#161513',
        font: '14px/1.5 system-ui, sans-serif',
      }}
    >
      <h1 style={{ maxWidth: 900, margin: '0 auto 16px', fontSize: 22, fontWeight: 600 }}>
        Nestify 界面运行失败
      </h1>
      <pre
        style={{
          maxWidth: 900,
          margin: '0 auto',
          whiteSpace: 'pre-wrap',
          color: '#fca5a5',
          background: '#292524',
          padding: 16,
          borderRadius: 6,
        }}
      >
        {message}
      </pre>
    </main>
  )
}

window.addEventListener('error', (event) => {
  console.error('[Nestify] renderer uncaught error', event.error ?? event.message)
  renderStartupError(event.error ?? event.message, 'Nestify 页面运行失败')
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Nestify] renderer unhandled rejection', event.reason)
  renderStartupError(event.reason, 'Nestify 页面异步操作失败')
})

try {
  if (!rootElement) throw new Error('Renderer root element #root is missing')
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <RendererErrorBoundary>
        <App />
      </RendererErrorBoundary>
    </React.StrictMode>,
  )
} catch (error) {
  console.error('[Nestify] renderer startup failed', error)
  renderStartupError(error)
}
