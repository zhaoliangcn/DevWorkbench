import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  /** 降级标题（如工作区名），帮助定位白屏范围 */
  title?: string
  /** 自定义降级 UI（默认：标题 + 错误消息 + 重试按钮） */
  fallback?: (error: Error, retry: () => void) => ReactNode
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 分层错误边界（设计附录 D P0）：App 根部包一层兜底，每个工作区再包一层 ——
 * 单个工作区崩溃只白该区，顶层导航与其余工作区不受影响。
 * 注意：边界无法捕获事件回调/异步流程中的错误，各工作区内的 IPC 调用仍需自行 try/catch。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const scope = this.props.title ?? 'root'
    console.error(`[ErrorBoundary:${scope}]`, error, info.componentStack)
  }

  /** 重试：清空错误状态，React 将重新挂载该子树 */
  private handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.handleRetry)
      return (
        <div className="error-boundary" role="alert">
          <h3>{this.props.title ?? '组件'}出了点问题</h3>
          <p className="error-boundary-message">{error.message}</p>
          <button className="error-boundary-btn" onClick={this.handleRetry}>
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
