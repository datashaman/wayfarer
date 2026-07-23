export const defaultIceServers = Object.freeze([
  Object.freeze({ urls: Object.freeze(['stun:stun.l.google.com:19302']) }),
])

function iceUrls(value) {
  const urls = typeof value === 'string' ? [value] : value
  if (!Array.isArray(urls) || !urls.length || urls.some((url) => typeof url !== 'string' || !/^(stun|stuns|turn|turns):/i.test(url))) {
    throw new Error('Each ICE server must contain a STUN or TURN URL.')
  }
  return urls
}

export function parseIceServers(value) {
  if (!value) return defaultIceServers

  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('ICE_SERVERS must be valid JSON.')
  }

  if (!Array.isArray(parsed) || !parsed.length) throw new Error('ICE_SERVERS must be a non-empty array.')

  return parsed.map((server) => {
    if (!server || typeof server !== 'object' || Array.isArray(server)) throw new Error('Each ICE server must be an object.')
    const urls = iceUrls(server.urls)
    if (server.username !== undefined && typeof server.username !== 'string') throw new Error('ICE server usernames must be strings.')
    if (server.credential !== undefined && typeof server.credential !== 'string') throw new Error('ICE server credentials must be strings.')
    return {
      urls,
      ...(server.username === undefined ? {} : { username: server.username }),
      ...(server.credential === undefined ? {} : { credential: server.credential }),
    }
  })
}
