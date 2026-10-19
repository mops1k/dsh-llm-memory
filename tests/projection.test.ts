import { describe, expect, it } from 'vitest'

import { projectInto, projectVectors } from '@llm-memory/core/application/projection'

function vector(values: number[], dim = 8): Float32Array {
  const result = new Float32Array(dim)
  result.set(values.slice(0, dim))
  return result
}

/** Cluster around one basis direction with a little noise. */
function cluster(axis: number, size: number, dim = 8, noise = 0.01): Float32Array[] {
  const vectors: Float32Array[] = []
  for (let index = 0; index < size; index++) {
    const values = new Array<number>(dim).fill(0)
    values[axis] = 1
    values[(axis + 1) % dim] = (index % 3) * noise
    values[(axis + 2) % dim] = ((index + 1) % 3) * noise
    vectors.push(vector(values, dim))
  }
  return vectors
}

function point(projection: { points: Float32Array }, index: number): [number, number] {
  return [projection.points[index * 2] ?? 0, projection.points[index * 2 + 1] ?? 0]
}

function distance(left: [number, number], right: [number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1])
}

describe('projectVectors', () => {
  it('separates well-spread clusters along the leading components', () => {
    const vectors = [...cluster(0, 4), ...cluster(1, 4), ...cluster(2, 4)]
    const projection = projectVectors(vectors)

    const means = [0, 1, 2].map((group) => {
      const members = [0, 1, 2, 3].map((index) => point(projection, group * 4 + index))
      return [
        members.reduce((sum, value) => sum + value[0], 0) / members.length,
        members.reduce((sum, value) => sum + value[1], 0) / members.length,
      ] as [number, number]
    })

    const spread = Math.max(
      ...[0, 1, 2].flatMap((group) =>
        [0, 1, 2, 3].map((index) => distance(point(projection, group * 4 + index), means[group]!)),
      ),
    )
    const between = Math.min(
      distance(means[0]!, means[1]!),
      distance(means[0]!, means[2]!),
      distance(means[1]!, means[2]!),
    )

    // Clusters must be farther apart than their own spread — that is what makes
    // the map readable instead of a single blob.
    expect(between).toBeGreaterThan(spread * 2)
  })

  it('is deterministic and reports variance shares that add up to at most one', () => {
    const vectors = [...cluster(0, 3), ...cluster(3, 3), ...cluster(5, 3)]
    const first = projectVectors(vectors)
    const second = projectVectors(vectors)

    expect(Array.from(first.points)).toEqual(Array.from(second.points))
    expect(Array.from(first.basis)).toEqual(Array.from(second.basis))
    expect(first.explained[0]).toBeGreaterThanOrEqual(first.explained[1])
    expect(first.explained[0] + first.explained[1]).toBeLessThanOrEqual(1.000001)
    expect(first.explained[0]).toBeGreaterThan(0.5)
  })

  it('keeps degenerate input finite', () => {
    const single = projectVectors([vector([1, 2, 3])])
    expect(Array.from(single.points)).toEqual([0, 0])
    expect(single.explained).toEqual([0, 0])
    expect(Array.from(single.points).some(Number.isNaN)).toBe(false)

    const identical = projectVectors([vector([1, 1, 1]), vector([1, 1, 1]), vector([1, 1, 1])])
    expect(Array.from(identical.points)).toEqual([0, 0, 0, 0, 0, 0])
    expect(identical.explained).toEqual([0, 0])

    const empty = projectVectors([])
    expect(empty.points.length).toBe(0)
    expect(empty.basis.length).toBe(0)

    // A vector of a different length must not poison the others.
    const mixed = projectVectors([vector([1, 0, 0, 0], 4), vector([9, 9, 9], 3), vector([0, 1, 0, 0], 4)])
    expect(Array.from(mixed.points).some(Number.isNaN)).toBe(false)
    expect(point(mixed, 1)).toEqual([0, 0])
    expect(Number.isFinite(point(mixed, 0)[0])).toBe(true)
    expect(Number.isFinite(point(mixed, 2)[0])).toBe(true)
  })

  it('projects a single vector to the same place as the batch did', () => {
    const vectors = [...cluster(0, 3), ...cluster(4, 3)]
    const projection = projectVectors(vectors)

    vectors.forEach((entry, index) => {
      const projected = projectInto(entry, projection)
      const [x, y] = point(projection, index)
      expect(projected.x).toBeCloseTo(x, 5)
      expect(projected.y).toBeCloseTo(y, 5)
    })
  })
})
