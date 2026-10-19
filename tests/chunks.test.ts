import { describe, expect, it } from 'vitest'

import { chunksUnchanged, chunkText, entryChunks, hashText } from '@llm-memory/core/application/chunks'
import { mergeConfig } from '@llm-memory/core/domain/config'

const config = mergeConfig({ embeddings: { chunkChars: 300, chunkOverlap: 60 } }).embeddings

describe('chunkText', () => {
  it('keeps a short text in one chunk', () => {
    const chunks = chunkText('Короткая запись про память.', { chunkChars: 800, chunkOverlap: 120 })
    expect(chunks).toEqual(['Короткая запись про память.'])
  })

  it('returns nothing for empty or blank input', () => {
    expect(chunkText('', { chunkChars: 100, chunkOverlap: 0 })).toEqual([])
    expect(chunkText('   \n\n  ', { chunkChars: 100, chunkOverlap: 0 })).toEqual([])
  })

  it('splits long text into windows of the requested size', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Предложение номер ${i} про индексацию памяти.`).join(' ')
    const chunks = chunkText(text, { chunkChars: 200, chunkOverlap: 0 })
    expect(chunks.length).toBeGreaterThan(3)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200)
    // Nothing is lost: the concatenation covers the original words in order.
    const joined = chunks.join(' ')
    for (const word of ['номер', 'индексацию', 'памяти']) expect(joined).toContain(word)
  })

  it('keeps the requested overlap between neighbouring chunks', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Строка ${i} с текстом про векторы и чанки.`).join(' ')
    const chunks = chunkText(text, { chunkChars: 180, chunkOverlap: 80 })
    expect(chunks.length).toBeGreaterThan(2)
    // Every chunk after the first opens with a word-aligned suffix of the one
    // before it, so the boundary context is repeated.
    for (let i = 1; i < chunks.length; i++) {
      const head = chunks[i]!.slice(0, 15)
      expect(chunks[i - 1]!.includes(head)).toBe(true)
    }
  })

  it('hard-splits a single over-long sentence and still advances', () => {
    const sentence = `Одно ${'очень '.repeat(300)}длинное предложение.`
    const chunks = chunkText(sentence, { chunkChars: 120, chunkOverlap: 119 })
    expect(chunks.length).toBeGreaterThan(2)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120)
  })

  it('caps the overlap at half the window', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Часть ${i} описания.`).join(' ')
    const chunks = chunkText(text, { chunkChars: 100, chunkOverlap: 100 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100)
  })
})

describe('entryChunks', () => {
  it('prepends the title and numbers the chunks densely', () => {
    const chunks = entryChunks({ title: 'Инкрементальный индекс', text: 'Тело записи про fingerprint.' }, config)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0]!.chunkIndex).toBe(0)
    expect(chunks[0]!.text.startsWith('Инкрементальный индекс\n')).toBe(true)
    chunks.forEach((chunk, index) => expect(chunk.chunkIndex).toBe(index))
  })

  it('adds keywords to the embedded text and hashes the model into the identity', () => {
    const entry = { title: 'Запись', text: 'Тело записи.', keywords: 'reindex fingerprint' }
    const chunks = entryChunks(entry, config)
    expect(chunks[0]!.text).toContain('keywords: reindex fingerprint')
    const other = entryChunks(entry, { ...config, model: 'another-model' })
    expect(other[0]!.hash).not.toBe(chunks[0]!.hash)
    expect(hashText('x')).toHaveLength(40)
  })
})

describe('chunksUnchanged', () => {
  const chunks = entryChunks({ title: 'Запись', text: 'Тело записи.' }, config)

  it('is true only for the same chunk set and hashes', () => {
    const stored = new Map(chunks.map((chunk) => [chunk.chunkIndex, chunk.hash]))
    expect(chunksUnchanged(stored, chunks)).toBe(true)
    expect(chunksUnchanged(new Map(), chunks)).toBe(false)
    expect(chunksUnchanged(new Map([[0, 'stale']]), chunks)).toBe(false)
    expect(chunksUnchanged(new Map([...stored, [9, 'extra']]), chunks)).toBe(false)
  })
})
