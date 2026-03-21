type MessageHandler = (data: any) => void

export function createWs(path: string, onMessage: MessageHandler): {
  send: (data: any) => void
  close: () => void
  getState: () => number
} {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${window.location.host}${path}`
  let ws: WebSocket | null = null
  let closed = false

  function connect() {
    ws = new WebSocket(url)

    ws.onopen = () => {
      onMessage({ type: '_connected' })
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
      } catch {
        // ignore malformed
      }
    }

    ws.onclose = () => {
      if (!closed) {
        onMessage({ type: '_disconnected' })
        // Auto-reconnect after 2s
        setTimeout(() => {
          if (!closed) connect()
        }, 2000)
      }
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  connect()

  return {
    send: (data: any) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data))
      }
    },
    close: () => {
      closed = true
      ws?.close()
    },
    getState: () => ws?.readyState ?? WebSocket.CLOSED,
  }
}
