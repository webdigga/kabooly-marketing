import { useCallback, useState } from 'react'
import { api, request } from '../../lib/api'
import { readEvents } from '../../lib/generation-stream'
import { limitMessage } from '../../lib/limits'
import type { Advert, AdvertImage, GenerationEvent, Platform, Usage } from '../../lib/types'
import type { TileStatus } from '../../components/ImageTile/ImageTile'

export interface Slot {
  platform: Platform
  status: TileStatus
  image?: AdvertImage
  error?: string
}

interface GeneratorState {
  advert: Advert | null
  slots: Slot[]
  running: boolean
  regeneratingText: boolean
  error: string | null
}

const INITIAL: GeneratorState = { advert: null, slots: [], running: false, regeneratingText: false, error: null }

function setSlot(slots: Slot[], platform: Platform, patch: Partial<Slot>): Slot[] {
  return slots.map((s) => (s.platform === platform ? { ...s, ...patch } : s))
}

function applyEvent(state: GeneratorState, event: GenerationEvent): GeneratorState {
  switch (event.type) {
    case 'advert':
      return { ...state, advert: event.advert }
    case 'image':
      return { ...state, slots: setSlot(state.slots, event.image.platform, { status: 'ready', image: event.image }) }
    case 'image_error':
      return { ...state, slots: setSlot(state.slots, event.platform, { status: 'error', error: event.error }) }
    case 'error':
      return { ...state, error: event.error, slots: [] }
    case 'done':
      return { ...state, running: false }
  }
}

// After the stream ends, nothing is left spinning: a stream cut short never
// sends "done", so missing images become errors (retryable once the advert
// exists) and a missing advert becomes an error message.
export function settle(state: GeneratorState): GeneratorState {
  if (!state.advert) {
    return { ...state, running: false, slots: [], error: state.error ?? 'The advert could not be made. Try again.' }
  }
  return {
    ...state,
    running: false,
    slots: state.slots.map((slot) =>
      slot.status === 'pending' ? { ...slot, status: 'error', error: 'This image did not arrive. Try regenerating it.' } : slot,
    ),
  }
}

function failure(err: unknown, fallback: string): string {
  return limitMessage(err) ?? fallback
}

// One advert at a time: text first, then each ticked platform's image as it
// arrives, with per-image and text-only regeneration afterwards.
export function useGenerator(onUsage: (usage: Usage) => void) {
  const [state, setState] = useState<GeneratorState>(INITIAL)
  const busy = state.running || state.regeneratingText || state.slots.some((s) => s.status === 'regenerating')

  const generate = useCallback(
    async (topic: string, platforms: Platform[]) => {
      setState({ ...INITIAL, running: true, slots: platforms.map((platform) => ({ platform, status: 'pending' })) })
      let res: Response
      try {
        res = await request('/api/generations', { body: { topic, platforms } })
      } catch (err) {
        setState({ ...INITIAL, error: failure(err, 'The advert could not be made. Try again.') })
        return
      }
      try {
        for await (const event of readEvents(res.body!)) {
          if (event.type === 'done') onUsage(event.usage)
          setState((s) => applyEvent(s, event))
        }
      } catch {
        // The connection dropped; whatever arrived stays on screen.
      }
      setState(settle)
    },
    [onUsage],
  )

  async function saveText(body: string) {
    if (!state.advert) return
    const { advert } = await api<{ advert: Advert }>(`/api/posts/${state.advert.id}`, { method: 'PATCH', body: { body } })
    setState((s) => ({ ...s, advert }))
  }

  async function regenerateText() {
    if (!state.advert) return
    setState((s) => ({ ...s, regeneratingText: true, error: null }))
    try {
      const { advert } = await api<{ advert: Advert }>(`/api/posts/${state.advert.id}/text`, { method: 'POST' })
      setState((s) => ({ ...s, advert: s.advert && { ...s.advert, body: advert.body }, regeneratingText: false }))
    } catch (err) {
      setState((s) => ({ ...s, regeneratingText: false, error: failure(err, 'New text could not be written. Try again.') }))
    }
  }

  async function regenerateImage(platform: Platform) {
    if (!state.advert) return
    setState((s) => ({ ...s, error: null, slots: setSlot(s.slots, platform, { status: 'regenerating', error: undefined }) }))
    try {
      const { image } = await api<{ image: AdvertImage }>(`/api/posts/${state.advert.id}/images/${platform}`, { method: 'POST' })
      setState((s) => ({ ...s, slots: setSlot(s.slots, platform, { status: 'ready', image }) }))
    } catch (err) {
      const message = failure(err, 'A new image could not be made. Try again.')
      setState((s) => ({ ...s, slots: setSlot(s.slots, platform, { status: 'error', error: message }) }))
    } finally {
      api<Usage>('/api/usage').then(onUsage, () => undefined)
    }
  }

  return { ...state, busy, generate, saveText, regenerateText, regenerateImage }
}
