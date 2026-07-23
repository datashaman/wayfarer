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

  constructor(private readonly url: string) {
    window.addEventListener('offline', this.handleOffline)
    window.addEventListener('online', this.handleOnline)
  }

  connect() {
    this.closedByClient = false
    if (!navigator.onLine) {
      this.setState('reconnecting')
      return
    }
    this.setState(this.attempts ? 'reconnecting' : 'connecting')
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.attempts = 0
      this.setState('live')
    })

    socket.addEventListener('message', ({ data }) => {
      if (this.socket !== socket) return
      try {
        const event = JSON.parse(String(data)) as ServerEvent
        this.eventHandlers.forEach((handler) => handler(event))
      } catch {
        // A malformed server message is ignored; production telemetry should record it.
      }
    })

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = undefined
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
    this.socket = undefined
    this.setState('offline')
    window.removeEventListener('offline', this.handleOffline)
    window.removeEventListener('online', this.handleOnline)
  }

  private handleOffline = () => {
    if (this.closedByClient) return
    window.clearTimeout(this.retryTimer)
    const socket = this.socket
    this.socket = undefined
    socket?.close()
    this.setState('reconnecting')
  }

  private handleOnline = () => {
    if (this.closedByClient || this.socket) return
    window.clearTimeout(this.retryTimer)
    this.connect()
  }

  private scheduleReconnect() {
    this.setState('reconnecting')
    if (!navigator.onLine) return
    window.clearTimeout(this.retryTimer)
    const delay = Math.min(1_000 * 2 ** this.attempts, 15_000)
    this.attempts += 1
    this.retryTimer = window.setTimeout(() => this.connect(), delay)
  }

  private setState(state: ConnectionState) {
    this.stateHandlers.forEach((handler) => handler(state))
  }
}
