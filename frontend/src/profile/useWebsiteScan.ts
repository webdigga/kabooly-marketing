import { useCallback, useRef, useState } from 'react'
import { api } from '../lib/api'
import { uploadLogoSvg } from '../lib/logo-upload'
import type { ScanResult } from '../lib/types'

export type ScanStatus = 'idle' | 'scanning' | 'found' | 'nothing' | 'failed'

export interface ScanFindings {
  colours: string[]
  logo: { key: string; url: string } | null
}

// Reads a website for brand colours and a logo. Never throws: any failure
// is a status the UI explains while the user carries on by hand.
export function useWebsiteScan() {
  const [status, setStatus] = useState<ScanStatus>('idle')
  const latest = useRef(0)

  const scan = useCallback(async (url: string): Promise<ScanFindings | null> => {
    const run = ++latest.current
    setStatus('scanning')
    try {
      const result = await api<ScanResult>('/api/profile/scan', { body: { url } })
      let logo = result.logo
      if (!logo && result.logoSvg) logo = await uploadLogoSvg(result.logoSvg).catch(() => null)
      if (run !== latest.current) return null
      const findings = { colours: result.colours, logo }
      const found = findings.colours.length > 0 || logo !== null
      setStatus(found ? 'found' : result.reachable ? 'nothing' : 'failed')
      return findings
    } catch {
      if (run === latest.current) setStatus('failed')
      return null
    }
  }, [])

  return { status, scan }
}
