/** Hash routing shared by the shell and the screens (no circular imports). */
export function readHash() {
  const raw = location.hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const params = Object.fromEntries(new URLSearchParams(query))
  return { route: path || 'overview', params }
}

export function navigate(route, params) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const text = query.toString()
  location.hash = `#/${route}${text ? `?${text}` : ''}`
}

/** Update the address bar without triggering the hashchange router. */
export function replaceHash(route, params) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const text = query.toString()
  history.replaceState(null, '', `#/${route}${text ? `?${text}` : ''}`)
}
