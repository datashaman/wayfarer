import type { ClientEvent, ConnectionState, ServerEvent } from '../types/protocol'

type EventHandler = (event: ServerEvent) => void
type StateHandler = (state: ConnectionState) => void

/** Thin RFC 6455 client. The caller supplies an authenticated WebSocket URL. */
export class RealtimeClient {
  private socket?: WebSocket
  private eventHandlers = new Set<EventHandler>()
  private stateHandlers = new Set<StateHandler>()
  private retryTimer?: number
  private attempts = 0
  private closedByClient = false

  constructor(private readonly url: string) {}

  connect() {
    this.closedByClient = false
    this.setState(this.attempts ? 'reconnecting' : 'connecting')
    this.socket = new WebSocket(this.url)

    this.socket.addEventListener('open', () => {
      this.attempts = 0
      this.setState('live')
    })

    this.socket.addEventListener('message', ({ data }) => {
      try {
        const event = JSON.parse(String(data)) as ServerEvent
        this.eventHandlers.forEach((handler) => handler(event))
      } catch {
        // A malformed server message is ignored; production telemetry should record it.
      }
    })

    this.socket.addEventListener('close', () => {
      if (this.closedByClient) {
        this.setState('offline')
        return
      }
      this.scheduleReconnect()
    })
  }

  send(event: ClientEvent) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(event))
    return true
  }

  onEvent(handler: EventHandler) {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  onState(handler: StateHandler) {
    this.stateHandlers.add(handler)
    return () => this.stateHandlers.delete(handler)
  }

  close() {
    this.closedByClient = true
    window.clearTimeout(this.retryTimer)
    this.socket?.close(1000, 'Client closed')
  }

  private scheduleReconnect() {
    this.setState('reconnecting')
    const delay = Math.min(1_000 * 2 ** this.attempts, 15_000)
    this.attempts += 1
    this.retryTimer = window.setTimeout(() => this.connect(), delay)
  }

  private setState(state: ConnectionState) {
    this.stateHandlers.forEach((handler) => handler(state))
  }
}
