import { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  type: 'sent' | 'received' | 'system'
  content: string
  timestamp: number
}

export function WebSocketTool() {
  const [url, setUrl] = useState('')
  const [connected, setConnected] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addMessage = (type: Message['type'], content: string) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      type,
      content,
      timestamp: Date.now(),
    }])
  }

  const connect = () => {
    if (!url) return
    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        addMessage('system', `已连接到 ${url}`)
      }

      ws.onmessage = (event) => {
        addMessage('received', event.data)
      }

      ws.onclose = () => {
        setConnected(false)
        addMessage('system', '连接已关闭')
        wsRef.current = null
      }

      ws.onerror = () => {
        addMessage('system', '连接出错')
      }
    } catch (error) {
      addMessage('system', `连接失败: ${(error as Error).message}`)
    }
  }

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
      setConnected(false)
    }
  }

  const sendMessage = () => {
    if (!message || !wsRef.current || !connected) return
    wsRef.current.send(message)
    addMessage('sent', message)
    setMessage('')
  }

  const clearMessages = () => {
    setMessages([])
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>WebSocket 调试</h3>
        <div className="tool-actions">
          <button onClick={clearMessages} className="btn-secondary">清空日志</button>
        </div>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <div className="url-bar">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="ws://localhost:8080/ws"
              disabled={connected}
            />
            {!connected ? (
              <button onClick={connect} disabled={!url}>连接</button>
            ) : (
              <button onClick={disconnect} className="btn-danger">断开</button>
            )}
            <span className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
              {connected ? '● 已连接' : '○ 未连接'}
            </span>
          </div>
        </div>

        <div className="tool-section">
          <h4>消息日志</h4>
          <div className="ws-messages">
            {messages.map((msg) => (
              <div key={msg.id} className={`ws-message ${msg.type}`}>
                <span className="msg-time">{formatTime(msg.timestamp)}</span>
                <span className="msg-type">
                  {msg.type === 'sent' ? '→' : msg.type === 'received' ? '←' : '•'}
                </span>
                <span className="msg-content">{msg.content}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {connected && (
          <div className="tool-section">
            <h4>发送消息</h4>
            <div className="input-group">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="输入要发送的消息"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendMessage()
                }}
              />
              <button onClick={sendMessage} disabled={!message}>发送</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
