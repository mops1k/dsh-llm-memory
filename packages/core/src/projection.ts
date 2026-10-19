/**
 * Two-dimensional projection of embedding vectors.
 *
 * The memory map needs coordinates for every entry, and the only thing we have
 * is a pile of 384-dimensional unit vectors. Full PCA (building and
 * diagonalizing the 384x384 covariance) costs ~150M multiply-adds per build and
 * a 590 KB matrix; the matrix-free power iteration below reaches the two leading
 * directions by touching the data only, in ~20 passes of O(n * dim). That is
 * fast enough to run on a request and small enough to keep in one function.
 *
 * Everything here is deterministic: the starting vector comes from a seeded
 * PRNG, so the same store always produces the same picture and two builds can be
 * compared by eye.
 */

/** Result of projecting a batch of vectors. */
export interface VectorProjection {
  /** Principal directions, `dim * 2` values: component 0 first, then component 1. */
  basis: Float32Array
  /** Mean of the input vectors, `dim` values; the projection subtracts it first. */
  mean: Float32Array
  /** Share of the total variance each component captures, 0..1. */
  explained: [number, number]
  /** `x, y` per input vector, in input order. */
  points: Float32Array
}

export interface ProjectionOptions {
  /** Power iterations per component. More is more precise, not less stable. */
  iterations?: number
  /** Seed of the deterministic starting vector. */
  seed?: number
}

const DEFAULT_ITERATIONS = 24
const DEFAULT_SEED = 0x5eed1e

/** Small deterministic PRNG (mulberry32) — no dependency, same numbers everywhere. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function randomUnit(dim: number, seed: number): Float32Array {
  const random = mulberry32(seed)
  const vector = new Float32Array(dim)
  for (let index = 0; index < dim; index++) vector[index] = random() * 2 - 1
  return normalize(vector)
}

function normalize(vector: Float32Array): Float32Array {
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm)
  if (norm === 0) return vector
  for (let index = 0; index < vector.length; index++) vector[index] = (vector[index] ?? 0) / norm
  return vector
}

/** Removes the `along` component from `vector` in place and normalizes it. */
function orthogonalize(vector: Float32Array, along: Float32Array): Float32Array {
  let dot = 0
  for (let index = 0; index < vector.length; index++) dot += (vector[index] ?? 0) * (along[index] ?? 0)
  for (let index = 0; index < vector.length; index++) {
    vector[index] = (vector[index] ?? 0) - dot * (along[index] ?? 0)
  }
  return normalize(vector)
}

/**
 * Projects every vector of `vectors` onto the two leading principal directions.
 *
 * Vectors whose length differs from the first one are skipped and land at the
 * origin, so a mixed batch can never produce NaN coordinates and the returned
 * coordinates always keep the input order.
 */
export function projectVectors(
  vectors: readonly Float32Array[],
  options: ProjectionOptions = {},
): VectorProjection {
  const iterations = Math.max(1, options.iterations ?? DEFAULT_ITERATIONS)
  const seed = options.seed ?? DEFAULT_SEED
  const dim = vectors.length > 0 ? (vectors[0]?.length ?? 0) : 0

  if (dim === 0 || vectors.length === 0) {
    return { basis: new Float32Array(0), mean: new Float32Array(0), explained: [0, 0], points: new Float32Array(0) }
  }

  // Centered copy of the whole batch: 1068 x 384 floats is ~1.6 MB, and having it
  // in one buffer keeps the iteration cache-friendly.
  const mean = new Float32Array(dim)
  let usable = 0
  for (const vector of vectors) {
    if (vector.length !== dim) continue
    usable++
    for (let index = 0; index < dim; index++) mean[index] = (mean[index] ?? 0) + (vector[index] ?? 0)
  }
  for (let index = 0; index < dim; index++) mean[index] = (mean[index] ?? 0) / Math.max(1, usable)

  const data = new Float32Array(usable * dim)
  /** Input index of every usable row, so `points` stays aligned with `vectors`. */
  const rows: number[] = []
  for (let input = 0; input < vectors.length; input++) {
    const vector = vectors[input]!
    if (vector.length !== dim) continue
    rows.push(input)
    const offset = rows.length - 1
    for (let index = 0; index < dim; index++) {
      data[offset * dim + index] = (vector[index] ?? 0) - (mean[index] ?? 0)
    }
  }

  const total = sumSquares(data)
  if (total === 0 || usable === 0) {
    return {
      basis: new Float32Array(dim * 2),
      mean,
      explained: [0, 0],
      points: new Float32Array(vectors.length * 2),
    }
  }

  const first = powerIteration(data, usable, dim, randomUnit(dim, seed), iterations)
  const firstVariance = directionalVariance(data, usable, dim, first)
  const basis = new Float32Array(dim * 2)
  basis.set(first, 0)

  const points = new Float32Array(vectors.length * 2)
  for (let index = 0; index < rows.length; index++) {
    points[rows[index]! * 2] = dotRow(data, index, dim, first)
  }

  // The second direction has to come from the residual: power iteration on the
  // original data would converge to the first direction again. Deflating in
  // place is safe because the first coordinates are already collected, and the
  // second coordinate is unchanged by removing a component it is orthogonal to.
  deflate(data, usable, dim, first)
  const second = orthogonalize(
    powerIteration(data, usable, dim, randomUnit(dim, seed ^ 0x9e3779b9), iterations),
    first,
  )
  const secondVariance = directionalVariance(data, usable, dim, second)
  basis.set(second, dim)

  for (let index = 0; index < rows.length; index++) {
    points[rows[index]! * 2 + 1] = dotRow(data, index, dim, second)
  }

  return {
    basis,
    mean,
    explained: [firstVariance / total, secondVariance / total],
    points,
  }
}

/** Projects a single vector with a basis produced by {@link projectVectors}. */
export function projectInto(
  vector: Float32Array,
  projection: Pick<VectorProjection, 'basis' | 'mean'>,
): { x: number; y: number } {
  const dim = projection.mean.length
  if (dim === 0 || vector.length !== dim) return { x: 0, y: 0 }
  let x = 0
  let y = 0
  for (let index = 0; index < dim; index++) {
    const centered = (vector[index] ?? 0) - (projection.mean[index] ?? 0)
    x += centered * (projection.basis[index] ?? 0)
    y += centered * (projection.basis[dim + index] ?? 0)
  }
  return { x, y }
}

function sumSquares(data: Float32Array): number {
  let total = 0
  for (const value of data) total += value * value
  return total
}

function dotRow(data: Float32Array, row: number, dim: number, direction: Float32Array): number {
  const offset = row * dim
  let dot = 0
  for (let index = 0; index < dim; index++) dot += (data[offset + index] ?? 0) * (direction[index] ?? 0)
  return dot
}

function directionalVariance(data: Float32Array, rows: number, dim: number, direction: Float32Array): number {
  let variance = 0
  for (let row = 0; row < rows; row++) {
    const value = dotRow(data, row, dim, direction)
    variance += value * value
  }
  return variance
}

/** Removes the projection onto `direction` from every row, in place. */
function deflate(data: Float32Array, rows: number, dim: number, direction: Float32Array): void {
  for (let row = 0; row < rows; row++) {
    const weight = dotRow(data, row, dim, direction)
    if (weight === 0) continue
    const offset = row * dim
    for (let index = 0; index < dim; index++) {
      data[offset + index] = (data[offset + index] ?? 0) - weight * (direction[index] ?? 0)
    }
  }
}

/** Largest eigenvector of the (implicit) covariance, by power iteration. */
function powerIteration(
  data: Float32Array,
  rows: number,
  dim: number,
  start: Float32Array,
  iterations: number,
): Float32Array {
  let current = normalize(start)
  for (let iteration = 0; iteration < iterations; iteration++) {
    const next = new Float32Array(dim)
    for (let row = 0; row < rows; row++) {
      const weight = dotRow(data, row, dim, current)
      if (weight === 0) continue
      const offset = row * dim
      for (let index = 0; index < dim; index++) {
        next[index] = (next[index] ?? 0) + weight * (data[offset + index] ?? 0)
      }
    }
    const norm = Math.sqrt(sumSquares(next))
    if (norm === 0) return current
    for (let index = 0; index < dim; index++) next[index] = (next[index] ?? 0) / norm
    const alignment = dotProduct(current, next)
    current = next
    if (alignment > 1 - 1e-7) break
  }
  return current
}

function dotProduct(left: Float32Array, right: Float32Array): number {
  let dot = 0
  for (let index = 0; index < left.length; index++) dot += (left[index] ?? 0) * (right[index] ?? 0)
  return dot
}
