/** Knowledge graph: deterministic force layout, pan/zoom, kind filters. */
import { app, tr, viewDef } from '../state.js'
import { card, emptyState, errorPanel, iconButton, pageHead, searchBox } from '../ui.js'
import { clamp, h, hashSeed, rng } from '../util.js'
import { openEntry } from './entry.js'

const WIDTH = 1000
const HEIGHT = 600
const PAD = 48

function layout(entities, edges) {
  const nodes = entities.map(entity => ({ ...entity, x: 0, y: 0, vx: 0, vy: 0, degree: 0 }))
  const byId = new Map(nodes.map(node => [node.id, node]))
  const kinds = [...new Set(nodes.map(node => node.kind))]
  const centers = new Map(kinds.map((kind, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, kinds.length) - Math.PI / 2
    return [kind, [WIDTH / 2 + Math.cos(angle) * 280, HEIGHT / 2 + Math.sin(angle) * 170]]
  }))
  for (const node of nodes) {
    const random = rng(hashSeed(`node:${node.id}`))
    const [cx, cy] = centers.get(node.kind) ?? [WIDTH / 2, HEIGHT / 2]
    const angle = random() * Math.PI * 2
    const radius = 45 + random() * 110
    node.x = cx + Math.cos(angle) * radius
    node.y = cy + Math.sin(angle) * radius
  }
  const links = edges
    .map(edge => ({ ...edge, a: byId.get(edge.source), b: byId.get(edge.target) }))
    .filter(edge => edge.a && edge.b)
  for (const link of links) {
    link.a.degree += 1
    link.b.degree += 1
  }

  for (let step = 0; step < 260; step += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let distance = Math.hypot(dx, dy) || 1
        if (distance < 1) {
          dx = 1
          dy = 1
          distance = 1.41
        }
        const push = 2600 / (distance * distance)
        a.vx += (dx / distance) * push
        a.vy += (dy / distance) * push
        b.vx -= (dx / distance) * push
        b.vy -= (dy / distance) * push
      }
    }
    for (const link of links) {
      const dx = link.b.x - link.a.x
      const dy = link.b.y - link.a.y
      const distance = Math.hypot(dx, dy) || 1
      const force = (distance - 150) * 0.012
      const ux = dx / distance
      const uy = dy / distance
      link.a.vx += ux * force
      link.a.vy += uy * force
      link.b.vx -= ux * force
      link.b.vy -= uy * force
    }
    for (const node of nodes) {
      node.vx += (WIDTH / 2 - node.x) * 0.0012
      node.vy += (HEIGHT / 2 - node.y) * 0.0012
      node.x = clamp(node.x + node.vx * 0.55, PAD, WIDTH - PAD)
      node.y = clamp(node.y + node.vy * 0.55, PAD, HEIGHT - PAD)
      node.vx *= 0.72
      node.vy *= 0.72
    }
  }
  return { nodes, links }
}

function truncate(text, length = 30) {
  const value = String(text ?? '')
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

export async function mount(container) {
  const view = viewDef('graph')
  const root = h('div', { class: 'page' })
  container.append(root)
  root.append(pageHead({ title: view.title, sub: tr('graph.subtitle') }))

  const host = h('div', { class: 'mt-16' })
  root.append(host)

  const reload = async () => {
    host.replaceChildren(card({ body: h('div', { class: 'skeleton', style: { height: '420px' } }) }))
    try {
      const data = await app.api.graph({ project: app.project })
      let entities = data?.entities ?? []
      let edges = data?.edges ?? []
      let capped = null
      // The live store can hold >1000 entries; a force layout of that size is
      // unusable on screen and slow, so the map shows the most connected nodes.
      if (entities.length > 120) {
        const degree = new Map()
        for (const edge of edges) {
          degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
          degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
        }
        const keep = new Set([...entities]
          .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
          .slice(0, 120)
          .map(entity => entity.id))
        entities = entities.filter(entity => keep.has(entity.id))
        edges = edges.filter(edge => keep.has(edge.source) && keep.has(edge.target))
        capped = { shown: entities.length, total: data.entities.length }
      }
      if (entities.length < 2 || !edges.length) {
        host.replaceChildren(card({ body: emptyState({ iconName: 'graph', title: tr('graph.empty'), text: tr('graph.emptyText') }) }))
        return
      }
      const { nodes, links } = layout(entities, edges)
      const kinds = [...new Set(nodes.map(node => node.kind))]
      const hidden = new Set()
      let query = ''
      let scale = 1
      let tx = 0
      let ty = 0

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`)
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-label', view.title)
      const world = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      svg.append(world)

      const applyTransform = () => {
        world.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`)
      }

      const fit = () => {
        const xs = nodes.map(node => node.x)
        const ys = nodes.map(node => node.y)
        const minX = Math.min(...xs) - 40
        const maxX = Math.max(...xs) + 40
        const minY = Math.min(...ys) - 40
        const maxY = Math.max(...ys) + 40
        scale = Math.min(WIDTH / (maxX - minX), HEIGHT / (maxY - minY), 2.3) * 0.94
        tx = (WIDTH - (maxX + minX) * scale) / 2
        ty = (HEIGHT - (maxY + minY) * scale) / 2
        applyTransform()
      }

      const draw = () => {
        while (world.firstChild) world.firstChild.remove()
        const visible = node => !hidden.has(node.kind)
        const matches = new Set(
          query
            ? nodes.filter(node => String(node.name).toLowerCase().includes(query.toLowerCase())).map(node => node.id)
            : [],
        )
        const hasQuery = query.trim().length > 0

        for (const link of links) {
          if (!visible(link.a) || !visible(link.b)) continue
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
          line.setAttribute('x1', link.a.x)
          line.setAttribute('y1', link.a.y)
          line.setAttribute('x2', link.b.x)
          line.setAttribute('y2', link.b.y)
          line.setAttribute('stroke', 'var(--border-strong)')
          line.setAttribute('stroke-width', '1')
          line.setAttribute('opacity', hasQuery ? '0.25' : '0.55')
          world.append(line)
        }

        const labels = new Set([...nodes]
          .filter(node => visible(node))
          .sort((a, b) => b.degree - a.degree)
          .slice(0, 6)
          .map(node => node.id))

        for (const node of nodes) {
          if (!visible(node)) continue
          const dim = hasQuery && !matches.has(node.id)
          const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
          group.setAttribute('class', 'graph-node')
          group.setAttribute('opacity', dim ? '0.18' : '1')
          const radius = 4.5 + Math.min(5, node.degree * 0.7)
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
          circle.setAttribute('cx', node.x)
          circle.setAttribute('cy', node.y)
          circle.setAttribute('r', String(radius))
          circle.setAttribute('fill', `var(--k-${node.kind}, var(--accent))`)
          circle.setAttribute('stroke', 'var(--surface)')
          circle.setAttribute('stroke-width', '1.5')
          const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
          title.textContent = node.name
          group.append(circle, title)
          group.setAttribute('tabindex', '0')
          group.setAttribute('role', 'button')
          group.addEventListener('click', () => openEntry(node.id))
          group.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              openEntry(node.id)
            }
          })
          group.addEventListener('mouseenter', () => { circle.setAttribute('r', String(radius + 2)) })
          group.addEventListener('mouseleave', () => { circle.setAttribute('r', String(radius)) })
          world.append(group)

        }

        // Labels are placed greedily and skipped when they would collide: six
        // top nodes by degree plus every search match, never a wall of text.
        const candidates = nodes
          .filter(node => visible(node) && (labels.has(node.id) || matches.has(node.id)))
          .sort((a, b) => (matches.has(b.id) ? 1 : 0) - (matches.has(a.id) ? 1 : 0) || b.degree - a.degree)
        const placed = []
        for (const node of candidates) {
          if (placed.length >= 10) break
          const radius = 4.5 + Math.min(5, node.degree * 0.7)
          const text = truncate(node.name, 26)
          const width = Math.min(190, text.length * 5.2)
          let box = null
          let y = 0
          for (const below of [false, true]) {
            const top = below ? node.y + radius + 3 : node.y - radius - 14
            const candidate = { x: node.x - width / 2, y: top, w: width, h: 12 }
            const clash = placed.some(other =>
              !(candidate.x + candidate.w < other.x || other.x + other.w < candidate.x ||
                candidate.y + candidate.h < other.y || other.y + other.h < candidate.y))
            if (!clash) {
              box = candidate
              y = below ? top + 9 : top + 9
              break
            }
          }
          if (!box) continue
          placed.push(box)
          const element = document.createElementNS('http://www.w3.org/2000/svg', 'text')
          element.setAttribute('class', 'graph-label')
          element.setAttribute('x', node.x)
          element.setAttribute('y', y)
          element.setAttribute('text-anchor', 'middle')
          element.setAttribute('opacity', matches.has(node.id) ? '1' : '0.85')
          element.textContent = text
          world.append(element)
        }
      }

      const search = searchBox({
        placeholder: tr('graph.placeholder'),
        onInput: value => { query = value; draw() },
        clearable: true,
      })
      search.style.maxWidth = '220px'
      search.setAttribute('data-page-search', 'true')

      const zoom = factor => {
        scale = clamp(scale * factor, 0.4, 4)
        applyTransform()
      }

      const legend = h('div', { class: 'viz-legend' },
        kinds.map(kind => {
          const chip = h('button', { class: 'chip', type: 'button' },
            h('i', { class: 'kind-dot', dataset: { kind } }),
            h('span', {}, kind),
            h('span', { class: 'faint' }, String(nodes.filter(node => node.kind === kind).length)),
          )
          chip.addEventListener('click', () => {
            if (hidden.has(kind)) hidden.delete(kind)
            else hidden.add(kind)
            chip.classList.toggle('active', hidden.has(kind))
            draw()
          })
          return chip
        }),
      )

      const viz = h('div', { class: 'viz' },
        svg,
        legend,
        h('div', { class: 'viz-hint faint', style: { fontSize: '11px', color: 'var(--text-3)' } }, tr('graph.hint')),
      )
      host.replaceChildren(card({
        title: `${tr('graph.nodes')}: ${nodes.length} · ${tr('graph.edges')}: ${links.length}${capped ? ` · ${tr('graph.capped', capped)}` : ''}`,
        actions: h('div', { class: 'flex items-center gap-6' },
          search,
          iconButton({ iconName: 'refresh', title: tr('graph.fit'), onClick: fit }),
          iconButton({ iconName: 'plus', title: tr('graph.zoomIn'), onClick: () => zoom(1.2) }),
          iconButton({ iconName: 'minus', title: tr('graph.zoomOut'), onClick: () => zoom(0.83) }),
        ),
        body: viz,
        flush: true,
      }))
      // The hint chip sits above the legend; keep the hint out of the click path.
      viz.querySelector('.viz-hint').style.pointerEvents = 'none'
      draw()
      fit()

      // pan / zoom
      let pointer = null
      svg.addEventListener('wheel', event => {
        event.preventDefault()
        const rect = svg.getBoundingClientRect()
        const px = ((event.clientX - rect.left) / rect.width) * WIDTH
        const py = ((event.clientY - rect.top) / rect.height) * HEIGHT
        const factor = Math.exp(-event.deltaY * 0.0012)
        const next = clamp(scale * factor, 0.4, 4)
        tx = px - ((px - tx) / scale) * next
        ty = py - ((py - ty) / scale) * next
        scale = next
        applyTransform()
      }, { passive: false })
      svg.addEventListener('pointerdown', event => {
        if (event.button !== 0) return
        pointer = { x: event.clientX, y: event.clientY, tx, ty }
        svg.setPointerCapture(event.pointerId)
        svg.style.cursor = 'grabbing'
      })
      svg.addEventListener('pointermove', event => {
        if (!pointer) return
        const rect = svg.getBoundingClientRect()
        tx = pointer.tx + ((event.clientX - pointer.x) / rect.width) * WIDTH
        ty = pointer.ty + ((event.clientY - pointer.y) / rect.height) * HEIGHT
        applyTransform()
      })
      const endPointer = () => { pointer = null; svg.style.cursor = '' }
      svg.addEventListener('pointerup', endPointer)
      svg.addEventListener('pointercancel', endPointer)
    } catch (error) {
      host.replaceChildren(card({ body: errorPanel(error, reload) }))
    }
  }

  app.refresh = reload
  await reload()
}
