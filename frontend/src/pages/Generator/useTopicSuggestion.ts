import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { limitMessage } from '../../lib/limits'

const MAX_AVOID = 10
const MAX_TOPIC = 200

// Suggests a topic on landing, and a different one on request. Earlier
// suggestions are sent back so the next one is new. A topic carried in on
// the address (from a keyword idea) is used instead, and nothing is asked
// for.
export function useTopicSuggestion() {
  const [params] = useSearchParams()
  const given = (params.get('topic') ?? '').trim().slice(0, MAX_TOPIC)
  const [topic, setTopic] = useState(given)
  const [suggesting, setSuggesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previous = useRef<string[]>([])

  const suggest = useCallback(async () => {
    setSuggesting(true)
    setError(null)
    try {
      const { topic: next } = await api<{ topic: string }>('/api/topics/suggest', {
        body: { avoid: previous.current.slice(-MAX_AVOID) },
      })
      previous.current.push(next)
      setTopic(next)
    } catch (err) {
      setError(limitMessage(err) ?? 'Could not suggest a topic. Type your own, or try again.')
    } finally {
      setSuggesting(false)
    }
  }, [])

  const started = useRef(false)
  useEffect(() => {
    // One suggestion on landing (StrictMode mounts effects twice in dev).
    if (started.current || given) return
    started.current = true
    void suggest()
  }, [suggest, given])

  return { topic, setTopic, suggesting, error, suggest }
}
