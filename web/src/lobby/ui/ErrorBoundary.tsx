/**
 * Catches a failure inside the 3D canvas and hands back a reason.
 *
 * Renderer failures are not exceptional enough to be left to chance: a driver
 * that refuses a context, a shader that will not compile on a particular GPU,
 * or an out-of-memory during texture upload all throw during render. Any of
 * them must land the visitor in Standard View with the services intact, never
 * on a blank page.
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  onError: (message: string) => void
  /** Rendered in place of the children once something has thrown. */
  fallback: ReactNode
}

interface State {
  failed: boolean
}

export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console for whoever has to reproduce it on that device.
    console.error('Aicountly Lobby: 3D scene failed to render.', error, info.componentStack)
    this.props.onError(error.message || 'The 3D view could not be started on this device.')
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback
    return this.props.children
  }
}
