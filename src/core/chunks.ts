/**
 * Chunking for the vector index.
 *
 * Memory pages average 1.5 kB, so most of them become exactly one chunk; the
 * chunker exists for the long tail (up to ~6 kB today) and for pages that grow
 * later. Chunks are sentence-aligned with a configurable overlap: a boundary in
 * the middle of a sentence would split a fact across two vectors and hurt both.
 *
 * The embedded text of a chunk is `title + "\n" + chunk`, because the title
 * carries the topic the body often does not repeat. Its hash covers the model
 * id and the dimension as well, so switching the model invalidates every vector
 * without a separate bookkeeping column.
 *
 * @module dsh-llm-memory/core/chunks
 */
import { createHash } from 'node:crypto'

import type { EmbeddingConfig } from './config.js'
import type { MemoryEntry } from './types.js'

/** Window sizes used by {@link chunkText}. */
export interface ChunkOptions {
  /** Target characters per chunk. */
  chunkChars: number
  /** Characters of the previous chunk repeated at the start of the next one. */
  chunkOverlap: number
}

/** One chunk of an entry, ready for embedding. */
export interface EntryChunk {
  /** Zero-based position inside the entry. */
  chunkIndex: number
  /** Text handed to the embedding model (title plus chunk body). */
  text: string
  /** Identity of that text under one model; used to skip unchanged chunks. */
  hash: string
}

/** Sentence boundary: end punctuation followed by whitespace, or a blank line. */
const SENTENCE_BOUNDARY = /(?<=[.!?…;:])\s+|\n{2,}/u

/** Split text into trimmed sentences, dropping empty ones. */
function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) return []
  return normalized
    .split(SENTENCE_BOUNDARY)
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter((part) => part.length > 0)
}

/** Break one over-long sentence into pieces of at most `maxChars`. */
function splitLongSentence(sentence: string, maxChars: number): string[] {
  const pieces: string[] = []
  let rest = sentence
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars)
    const space = window.lastIndexOf(' ')
    // Prefer a word boundary, but never cut off more than half the window.
    const take = space > maxChars / 2 ? space : maxChars
    pieces.push(rest.slice(0, take).trim())
    rest = rest.slice(take).trim()
  }
  if (rest.length > 0) pieces.push(rest)
  return pieces
}

/** Text split into pieces that each fit one chunk window. */
function sentencePieces(text: string, maxChars: number): string[] {
  const pieces: string[] = []
  for (const sentence of splitSentences(text)) {
    if (sentence.length <= maxChars) pieces.push(sentence)
    else pieces.push(...splitLongSentence(sentence, maxChars))
  }
  return pieces.filter((piece) => piece.length > 0)
}

/**
 * Split text into sentence-aligned chunks of about `chunkChars` characters.
 *
 * A short text yields one chunk; the overlap is capped at half the window so a
 * window always advances.
 */
export function chunkText(text: string, options: ChunkOptions): string[] {
  const chunkChars = Math.max(1, Math.floor(options.chunkChars))
  const overlap = Math.max(0, Math.min(Math.floor(options.chunkOverlap), Math.floor(chunkChars / 2)))
  const pieces = sentencePieces(text ?? '', chunkChars)
  if (pieces.length === 0) return []

  const chunks: string[] = []
  let start = 0
  while (start < pieces.length) {
    let end = start
    let length = 0
    while (end < pieces.length) {
      const grow = pieces[end]!.length + (length > 0 ? 1 : 0)
      if (length > 0 && length + grow > chunkChars) break
      length += grow
      end++
    }
    const chunk = pieces.slice(start, end).join(' ')
    if (chunk.length > 0) chunks.push(chunk)
    if (end >= pieces.length) break
    // Step forward, keeping the tail of this window as context for the next.
    let next = end
    let carried = 0
    while (next > start + 1 && carried < overlap) {
      next--
      carried += pieces[next]!.length + 1
    }
    start = next > start ? next : end
  }
  return chunks
}

/** SHA-1 of a string, used as the vector cache key. */
export function hashText(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

/** Fields of an entry the chunker reads. */
export type ChunkableEntry = Pick<MemoryEntry, 'title' | 'text'> & Partial<Pick<MemoryEntry, 'keywords' | 'tags'>>

/**
 * Chunks of one entry as they are embedded: title plus body (plus keywords),
 * each with the hash of the exact text and model.
 */
export function entryChunks(entry: ChunkableEntry, config: EmbeddingConfig): EntryChunk[] {
  const parts = [entry.text ?? '']
  const keywords = (entry.keywords ?? '').trim()
  if (keywords.length > 0) parts.push(`keywords: ${keywords}`)
  const body = parts.filter((part) => part.length > 0).join('\n')
  const title = (entry.title ?? '').replace(/\s+/gu, ' ').trim()
  return chunkText(body, { chunkChars: config.chunkChars, chunkOverlap: config.chunkOverlap }).map(
    (chunk, chunkIndex) => {
      const text = title.length > 0 ? `${title}\n${chunk}` : chunk
      return { chunkIndex, text, hash: hashText(`${config.model}|${config.dim}|${text}`) }
    },
  )
}

/** Whether the stored chunk hashes still describe the same chunks. */
export function chunksUnchanged(stored: ReadonlyMap<number, string>, chunks: readonly EntryChunk[]): boolean {
  if (stored.size !== chunks.length) return false
  for (const chunk of chunks) {
    if (stored.get(chunk.chunkIndex) !== chunk.hash) return false
  }
  return true
}
