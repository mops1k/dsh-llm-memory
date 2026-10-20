/** Small DOM, format and text helpers shared by every screen. */

export function h(tag, props, ...children) {
  const el = document.createElement(tag)
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue
      if (key === 'class' || key === 'className') {
        el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value)
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value)
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value)
      } else if (key === 'html') {
        el.innerHTML = value
      } else if (key === 'text') {
        el.textContent = value
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value)
      } else if (key === 'checked' || key === 'disabled' || key === 'readOnly' || key === 'selected') {
        el[key] = Boolean(value)
      } else if (key === 'value') {
        el.value = value
      } else {
        el.setAttribute(key, String(value))
      }
    }
  }
  appendChildren(el, children)
  return el
}

export function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove()
  return el
}

export function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'ic')
  svg.setAttribute('aria-hidden', 'true')
  if (size) {
    svg.style.width = `${size}px`
    svg.style.height = `${size}px`
  }
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttribute('href', `#i-${name}`)
  svg.append(use)
  return svg
}

export const fmtInt = new Intl.NumberFormat('ru-RU')

export function fmtNumber(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'number') return Number.isFinite(value) ? fmtInt.format(value) : '—'
  return String(value)
}

export function fmtBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${value} Б`
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ']
  let size = value / 1024
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[index]}`
}

export function fmtDate(iso, locale = 'ru', withTime = false) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

export function timeAgo(iso, locale = 'ru') {
  if (!iso) return '—'
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return '—'
  const diff = Math.round((time - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale === 'ru' ? 'ru-RU' : 'en', { numeric: 'auto' })
  const steps = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
    [Infinity, 'year'],
  ]
  let value = diff
  for (const [limit, unit] of steps) {
    if (Math.abs(value) < limit) return rtf.format(value, unit)
    value = Math.round(value / limit)
  }
  return rtf.format(value, 'year')
}

/** Read a dotted path (`byKind.rules`) out of a payload. */
export function getPath(source, path) {
  if (!source) return undefined
  let node = source
  for (const part of String(path).split('.')) {
    if (node === null || node === undefined) return undefined
    node = node[part]
  }
  return node
}

export function hashSeed(text) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function rng(seed) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function debounce(fn, wait = 220) {
  let timer = 0
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function basename(path) {
  return String(path ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the textarea path
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Deliberately tiny markdown renderer for lint/heal reports: headings, lists,
 * bold, inline code, links and paragraphs. Everything is escaped first.
 */
let listItems = []

export function markdown(source) {
  if (typeof source !== 'string') return ''
  const escaped = escapeHtml(source.trim())
  const lines = escaped.split(/\r?\n/)
  const out = []
  let list = null
  const inline = text =>
    text
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (list) {
        out.push(`<${list}>${listItems.join('')}</${list}>`)
        list = null
      }
      continue
    }
    if (/^###\s/.test(trimmed)) {
      if (list) { out.push(`<${list}>${listItems.join('')}</${list}>`); list = null }
      out.push(`<h3>${inline(trimmed.replace(/^###\s+/, ''))}</h3>`)
      continue
    }
    if (/^[-*]\s/.test(trimmed)) {
      if (list !== 'ul') { if (list) out.push(`<${list}>${listItems.join('')}</${list}>`); list = 'ul'; listItems = [] }
      listItems.push(`<li>${inline(trimmed.replace(/^[-*]\s+/, ''))}</li>`)
      continue
    }
    if (/^\d+[.)]\s/.test(trimmed)) {
      if (list !== 'ol') { if (list) out.push(`<${list}>${listItems.join('')}</${list}>`); list = 'ol'; listItems = [] }
      listItems.push(`<li>${inline(trimmed.replace(/^\d+[.)]\s+/, ''))}</li>`)
      continue
    }
    if (list) { out.push(`<${list}>${listItems.join('')}</${list}>`); list = null }
    out.push(`<p>${inline(trimmed)}</p>`)
  }
  if (list) out.push(`<${list}>${listItems.join('')}</${list}>`)
  return out.join('')
}

export function kindElement(kind) {
  const wrap = h('span', { class: 'kind', dataset: { kind } })
  wrap.append(h('i', { class: 'kind-dot' }), String(kind ?? '—'))
  return wrap
}

export function statusBadge(status) {
  const map = {
    active: ['badge-ok', 'активна'],
    superseded: ['badge', 'забыта'],
    deleted: ['badge-danger', 'удалена'],
  }
  const [cls, label] = map[status] ?? ['badge', status]
  return h('span', { class: `badge ${cls}` }, label)
}

export function relativeUrl(hash) {
  return `#/${hash}`
}
