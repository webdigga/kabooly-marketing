import type { GenerationEvent } from './types'

// Reads the newline-delimited JSON a generation streams back, yielding each
// event as soon as its line is complete (lines can straddle chunks).
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<GenerationEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as GenerationEvent
    }
    if (done) break
  }
  if (buffer.trim()) yield JSON.parse(buffer) as GenerationEvent
}
