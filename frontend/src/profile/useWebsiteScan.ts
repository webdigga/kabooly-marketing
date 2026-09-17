import { useCallback, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { uploadLogoSvg } from '../lib/logo-upload'
import type { BusinessDetails, ScanResult } from '../lib/types'

export type ScanStatus = 'idle' | 'scanning' | 'found' | 'nothing' | 'failed' | 'limited'

export interface ScanFindings {
  colours: string[]
  logo: { key: string; url: string } | null
  details: BusinessDetails | null
}

function foundAnything(findings: ScanFindings): boolean {
  const d = findings.details
  const details = d !== null && (Object.values(d) as unknown[]).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)))
  return findings.colours.length > 0 || findings.logo !== null || details
}

// Reads a website for the business's details, brand colours and logo. Never
// throws: any failure is a status the UI explains while the user carries on
// by hand.
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
      const findings = { colours: result.colours, logo, details: result.details }
      setStatus(foundAnything(findings) ? 'found' : result.reachable ? 'nothing' : 'failed')
      return findings
    } catch (err) {
      const limited = err instanceof ApiError && err.status === 429
      if (run === latest.current) setStatus(limited ? 'limited' : 'failed')
      return null
    }
  }, [])

  return { status, scan }
}
