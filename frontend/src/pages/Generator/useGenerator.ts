import { useCallback, useState } from 'react'
import type { BackgroundStatus } from '../../components/CarouselSlides/CarouselSlides'
import type { CreateFormat } from '../../components/FormatPicker/FormatPicker'
import type { TileStatus } from '../../components/ImageTile/ImageTile'
import { api, request } from '../../lib/api'
import { readEvents } from '../../lib/generation-stream'
import { limitMessage } from '../../lib/limits'
import type { Advert, AdvertImage, GenerationEvent, Platform, Slide, StoredFile, Usage } from '../../lib/types'

export interface Slot {
  platform: Platform
  status: TileStatus
  image?: AdvertImage
  error?: string
}

interface GeneratorState {
  format: CreateFormat
  advert: Advert | null
  slots: Slot[]
  background: StoredFile | null
  backgroundStatus: BackgroundStatus | null
  // The movement to start a video with, once the advert exists.
  videoMotion: string | null
  running: boolean
  regeneratingText: boolean
  regeneratingSlides: boolean
  error: string | null
}

const INITIAL: GeneratorState = {
  format: 'images',
  advert: null,
  slots: [],
  background: null,
  backgroundStatus: null,
  videoMotion: null,
  running: false,
  regeneratingText: false,
  regeneratingSlides: false,
  error: null,
}

export interface GenerateOptions {
  format: CreateFormat
  topic: string
  platforms: Platform[]
  photoKey?: string
  motion?: string
}

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
    case 'background':
      return { ...state, background: event.background, backgroundStatus: 'ready' }
    case 'background_error':
      return { ...state, backgroundStatus: 'error' }
    case 'error':
      return { ...state, error: event.error, slots: [], backgroundStatus: null }
    case 'done':
      return { ...state, running: false }
  }
}

// After the stream ends, nothing is left spinning: a stream cut short never
// sends "done", so missing images become errors (retryable once the advert
// exists) and a missing advert becomes an error message.
export function settle(state: GeneratorState): GeneratorState {
  if (!state.advert) {
    return {
      ...state,
      running: false,
      slots: [],
      backgroundStatus: null,
      videoMotion: null,
      error: state.error ?? 'The advert could not be made. Try again.',
    }
  }
  return {
    ...state,
    running: false,
    backgroundStatus: state.backgroundStatus === 'pending' ? 'error' : state.backgroundStatus,
    slots: state.slots.map((slot) =>
      slot.status === 'pending' ? { ...slot, status: 'error', error: 'This image did not arrive. Try regenerating it.' } : slot,
    ),
  }
}

function failure(err: unknown, fallback: string): string {
  return limitMessage(err) ?? fallback
}

// The request body for each thing the create screen makes. A video starts
// as an image-free advert; the video itself is started once it exists.
function generationBody(options: GenerateOptions) {
  const { topic, platforms } = options
  switch (options.format) {
    case 'images':
      return { format: 'images', topic, platforms }
    case 'photo':
      return { format: 'photo', topic, platforms, photoKey: options.photoKey }
    case 'carousel':
      return { format: 'carousel', topic }
    case 'video':
      return { format: 'images', topic, platforms: [] }
  }
}

function startingState(options: GenerateOptions): GeneratorState {
  const hasImages = options.format === 'images' || options.format === 'photo'
  return {
    ...INITIAL,
    format: options.format,
    running: true,
    slots: hasImages ? options.platforms.map((platform) => ({ platform, status: 'pending' as const })) : [],
    backgroundStatus: options.format === 'carousel' ? 'pending' : null,
    videoMotion: options.format === 'video' ? (options.motion ?? '') : null,
  }
}

// One advert at a time: words first, then each picture as it arrives, with
// regeneration of each part afterwards.
export function useGenerator(onUsage: (usage: Usage) => void) {
  const [state, setState] = useState<GeneratorState>(INITIAL)
  const busy =
    state.running ||
    state.regeneratingText ||
    state.regeneratingSlides ||
    (state.backgroundStatus === 'pending' && !state.running) ||
    state.slots.some((s) => s.status === 'regenerating')

  const generate = useCallback(
    async (options: GenerateOptions) => {
      setState(startingState(options))
      let res: Response
      try {
        res = await request('/api/generations', { body: generationBody(options) })
      } catch (err) {
        setState({ ...INITIAL, format: options.format, error: failure(err, 'The advert could not be made. Try again.') })
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

  const refreshUsage = useCallback(() => {
    api<Usage>('/api/usage').then(onUsage, () => undefined)
  }, [onUsage])

  async function saveText(body: string) {
    if (!state.advert) return
    const { advert } = await api<{ advert: Advert }>(`/api/posts/${state.advert.id}`, { method: 'PATCH', body: { body } })
    setState((s) => ({ ...s, advert }))
  }

  async function saveSlides(slides: Slide[]) {
    if (!state.advert) return
    const { advert } = await api<{ advert: Advert }>(`/api/posts/${state.advert.id}`, { method: 'PATCH', body: { slides } })
    setState((s) => ({ ...s, advert: s.advert && { ...s.advert, slides: advert.slides } }))
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

  async function regenerateSlides() {
    if (!state.advert) return
    setState((s) => ({ ...s, regeneratingSlides: true, error: null }))
    try {
      const { advert } = await api<{ advert: Advert }>(`/api/posts/${state.advert.id}/slides`, { method: 'POST' })
      setState((s) => ({ ...s, advert: s.advert && { ...s.advert, slides: advert.slides }, regeneratingSlides: false }))
    } catch (err) {
      setState((s) => ({ ...s, regeneratingSlides: false, error: failure(err, 'New slides could not be written. Try again.') }))
    }
  }

  async function regenerateBackground() {
    if (!state.advert) return
    setState((s) => ({ ...s, backgroundStatus: 'pending', error: null }))
    try {
      const { background } = await api<{ background: StoredFile }>(`/api/posts/${state.advert.id}/background`, { method: 'POST' })
      setState((s) => ({ ...s, background, backgroundStatus: 'ready' }))
    } catch (err) {
      setState((s) => ({
        ...s,
        backgroundStatus: s.background ? 'ready' : 'error',
        error: failure(err, 'A new photo could not be made. Try again.'),
      }))
    } finally {
      refreshUsage()
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
      refreshUsage()
    }
  }

  return {
    ...state,
    busy,
    generate,
    saveText,
    saveSlides,
    regenerateText,
    regenerateSlides,
    regenerateBackground,
    regenerateImage,
  }
}
