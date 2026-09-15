import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import Button from '../Button/Button'

interface CopyButtonProps {
  text: string
  label?: string
  testId?: string
}

export default function CopyButton({ text, label = 'Copy text', testId }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  const shown = { idle: label, copied: 'Copied', failed: 'Copy failed' }[state]
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={state === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      onClick={() => void copy()}
      data-testid={testId}
    >
      <span aria-live="polite">{shown}</span>
    </Button>
  )
}
