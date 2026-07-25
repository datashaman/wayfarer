function serverOrigin() {
  if (import.meta.env.VITE_SERVER_URL) return String(import.meta.env.VITE_SERVER_URL)
  return import.meta.env.DEV ? `${location.protocol}//${location.hostname}:8787` : location.origin
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${serverOrigin()}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? 'Unable to reach the table.')
  return body as T
}
