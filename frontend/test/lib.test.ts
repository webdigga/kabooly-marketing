import { describe, expect, it } from 'vitest'
import { ApiError, errorMessage } from '../src/lib/api'
import { readEvents } from '../src/lib/generation-stream'
import { limitMessage, localTime, usageLine } from '../src/lib/limits'
import { loadPlatformChoice, savePlatformChoice } from '../src/lib/platform-choice'
import { svgSize } from '../src/lib/svg-to-png'
import { draftFromProfile, draftToBody, EMPTY_DRAFT, fieldFromServer, validate } from '../src/profile/draft'
import { PROFILE } from './helpers'

const NOW = new Date(2026, 8, 15, 9, 0)

function limitError(body: Record<string, unknown>) {
  return new ApiError(429, body)
}

describe('limit messages', () => {
  it('formats times in local time, noting tomorrow', () => {
    expect(localTime(new Date(2026, 8, 15, 15, 42).toISOString(), NOW)).toBe('3:42pm')
    expect(localTime(new Date(2026, 8, 16, 8, 5).toISOString(), NOW)).toBe('8:05am tomorrow')
  })

  it('explains each limit', () => {
    const at = new Date(2026, 8, 15, 15, 42).toISOString()
    expect(limitMessage(limitError({ code: 'busy' }), NOW)).toContain('still being made')
    expect(limitMessage(limitError({ code: 'rate_limit', retryAt: at }), NOW)).toContain('Try again at 3:42pm')
    expect(limitMessage(limitError({ code: 'daily_image_limit', remaining: 0, limit: 20, nextFreeAt: at }), NOW)).toBe(
      'You have made all 20 images allowed in 24 hours. Your next image is available at 3:42pm.',
    )
    expect(limitMessage(limitError({ code: 'daily_image_limit', remaining: 1, nextFreeAt: at }), NOW)).toContain(
      'You have 1 image left today. Tick fewer platforms',
    )
    expect(limitMessage(limitError({ code: 'daily_text_limit', nextFreeAt: at }), NOW)).toContain("today's limit for text")
    expect(limitMessage(limitError({ code: 'other' }), NOW)).toBe('Too many requests. Try again shortly.')
  })

  it('ignores errors that are not limits', () => {
    expect(limitMessage(new ApiError(500, {}))).toBeNull()
    expect(limitMessage(new Error('x'))).toBeNull()
  })

  it('describes usage', () => {
    expect(usageLine(2, 20)).toBe('18 images left today (20 per 24 hours)')
    expect(usageLine(19, 20)).toBe('1 image left today (20 per 24 hours)')
    expect(usageLine(25, 20)).toBe('0 images left today (20 per 24 hours)')
  })
})

describe('errorMessage', () => {
  it('shows server copy for client errors only', () => {
    expect(errorMessage(new ApiError(409, { error: 'Complete your business profile first' }), 'x')).toBe(
      'Complete your business profile first',
    )
    expect(errorMessage(new ApiError(400, { error: 'Invalid request' }), 'fallback')).toBe('fallback')
    expect(errorMessage(new ApiError(502, { error: 'Generation failed' }), 'fallback')).toBe('fallback')
    expect(errorMessage(new Error('x'), 'fallback')).toBe('fallback')
  })
})

describe('readEvents', () => {
  it('yields events as lines complete, across chunk boundaries', async () => {
    const text = '{"type":"advert","advert":{"id":"a"}}\n{"type":"do' + 'ne","usage":{}}\n\n{"type":"error","error":"x"}'
    const bytes = new TextEncoder().encode(text)
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 20))
        c.enqueue(bytes.slice(20, 50))
        c.enqueue(bytes.slice(50))
        c.close()
      },
    })
    const types: string[] = []
    for await (const event of readEvents(stream)) types.push(event.type)
    expect(types).toEqual(['advert', 'done', 'error'])
  })
})

describe('svgSize', () => {
  function svg(attrs: string) {
    return new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}></svg>`, 'image/svg+xml').documentElement
  }

  it('scales to 1024 on the long edge using width and height, or the viewBox', () => {
    expect(svgSize(svg('width="200" height="100"'))).toEqual({ width: 1024, height: 512 })
    expect(svgSize(svg('width="100%" height="100%" viewBox="0 0 50 100"'))).toEqual({ width: 512, height: 1024 })
    expect(svgSize(svg('viewBox="0,0,300,300"'))).toEqual({ width: 1024, height: 1024 })
    expect(svgSize(svg(''))).toEqual({ width: 1024, height: 1024 })
  })
})

describe('platform choice', () => {
  it('remembers the ticked platforms and defaults to all three', () => {
    expect(loadPlatformChoice()).toEqual(['instagram', 'facebook', 'nextdoor'])
    savePlatformChoice(['nextdoor'])
    expect(loadPlatformChoice()).toEqual(['nextdoor'])
    localStorage.setItem('kabooly-marketing-platforms', '{bad json')
    expect(loadPlatformChoice()).toEqual(['instagram', 'facebook', 'nextdoor'])
  })
})

describe('profile draft', () => {
  it('validates only the fields asked for', () => {
    expect(validate(EMPTY_DRAFT, ['businessName', 'services'])).toEqual({
      businessName: 'Enter your business name.',
      services: 'Add at least one service or product.',
    })
    expect(validate({ ...EMPTY_DRAFT, websiteUrl: 'not a site' }, ['websiteUrl'])).toEqual({
      websiteUrl: 'Enter a website address like acme.co.uk.',
    })
    expect(validate({ ...EMPTY_DRAFT, websiteUrl: 'acme.co.uk/about' }, ['websiteUrl'])).toEqual({})
    expect(validate(EMPTY_DRAFT, ['websiteUrl', 'tone'])).toEqual({})
  })

  it('round-trips a profile into the API body', () => {
    const draft = draftFromProfile({ ...PROFILE, logoKey: 'users/u1/logos/x.png', logoUrl: '/api/files/users/u1/logos/x.png' })
    expect(draft.logo).toEqual({ key: 'users/u1/logos/x.png', url: '/api/files/users/u1/logos/x.png' })
    expect(draftToBody({ ...draft, websiteUrl: '  ', businessName: ' Acme ' })).toMatchObject({
      businessName: 'Acme',
      websiteUrl: null,
      logoKey: 'users/u1/logos/x.png',
    })
    expect(draftFromProfile({ ...PROFILE, websiteUrl: null }).websiteUrl).toBe('')
  })

  it('maps server field names back to draft fields', () => {
    expect(fieldFromServer('brandColours.0')).toBe('brandColours')
    expect(fieldFromServer('logoKey')).toBe('logo')
    expect(fieldFromServer('nonsense')).toBeNull()
    expect(fieldFromServer(undefined)).toBeNull()
  })
})
