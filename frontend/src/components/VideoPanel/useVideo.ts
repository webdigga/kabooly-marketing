import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { limitMessage } from '../../lib/limits'
import type { AdvertVideo, Usage } from '../../lib/types'
import { VIDEO_POLL_MS } from '../../lib/video'

// One advert's video: starts it, then checks back every few seconds while
// Google makes it. Leaving the page stops the checks; the video carries on
// and is picked up again from the library.
export function useVideo(advertId: string, initial: AdvertVideo | null, onUsage?: (usage: Usage) => void) {
  const [video, setVideo] = useState<AdvertVideo | null>(initial)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const body = await api<{ video: AdvertVideo }>(`/api/posts/${advertId}/video`)
      setVideo(body.video)
    } catch {
      // A missed check is retried on the next tick.
      setVideo((v) => (v ? { ...v } : v))
    }
  }, [advertId])

  const pending = video?.status === 'pending'
  useEffect(() => {
    if (!pending) return undefined
    timer.current = setTimeout(() => void refresh(), VIDEO_POLL_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [pending, video, refresh])

  const start = useCallback(
    async (motion: string) => {
      setStarting(true)
      setError(null)
      try {
        const body = await api<{ video: AdvertVideo; usage: Usage }>(`/api/posts/${advertId}/video`, {
          body: { motion: motion.trim() || null },
        })
        setVideo(body.video)
        onUsage?.(body.usage)
      } catch (err) {
        setError(limitMessage(err) ?? 'The video could not be started. Try again.')
      } finally {
        setStarting(false)
      }
    },
    [advertId, onUsage],
  )

  return { video, starting, error, start }
}
