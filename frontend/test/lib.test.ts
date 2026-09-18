import { describe, expect, it, vi } from 'vitest'
import { ApiError, errorMessage } from '../src/lib/api'
import { makeBrandStrip, uploadBrandStrip, websiteLabel } from '../src/lib/brand-strip'
import { readEvents } from '../src/lib/generation-stream'
import { limitMessage, localTime, usageRows } from '../src/lib/limits'
import { loadPlatformChoice, savePlatformChoice } from '../src/lib/platform-choice'
import { headingColour, slideKind, wrapLines } from '../src/lib/slide-render'
import { svgSize } from '../src/lib/svg-to-png'
import { draftFromProfile, draftToBody, EMPTY_DRAFT, fieldFromServer, validate } from '../src/profile/draft'
import { applyFindings, changedSummary } from '../src/profile/website-fill'
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
    const later = new Date(2026, 8, 22, 9, 30).toISOString()
    expect(limitMessage(limitError({ code: 'monthly_image_limit', remaining: 0, limit: 150, nextFreeAt: later }), NOW)).toBe(
      'You have made all 150 images allowed in 30 days. Your next image is available at 9:30am on Tue 22 Sept.',
    )
    expect(limitMessage(limitError({ code: 'monthly_image_limit', remaining: 2, nextFreeAt: later }), NOW)).toContain('2 images left this month')
    expect(limitMessage(limitError({ code: 'monthly_video_limit', limit: 20, nextFreeAt: later }), NOW)).toBe(
      'You have made all 20 videos allowed in 30 days. Your next video is available at 9:30am on Tue 22 Sept.',
    )
    expect(limitMessage(limitError({ code: 'rate_limit' }), NOW)).toContain('Try again at')
    expect(limitMessage(limitError({ code: 'other' }), NOW)).toBe('Too many requests. Try again shortly.')
  })

  it('ignores errors that are not limits', () => {
    expect(limitMessage(new ApiError(500, {}))).toBeNull()
    expect(limitMessage(new Error('x'))).toBeNull()
  })

  it('describes what is left, with when more frees up once used up', () => {
    const at = new Date(2026, 8, 20, 10, 0).toISOString()
    expect(
      usageRows(
        {
          imagesToday: { used: 19, limit: 20, nextFreeAt: null },
          imagesThisMonth: { used: 150, limit: 150, nextFreeAt: at },
          videosThisMonth: { used: 25, limit: 20, nextFreeAt: null },
        },
        NOW,
      ),
    ).toEqual([
      { label: 'images today', left: 1, limit: 20, usedShare: 0.95, low: true, freeAt: null },
      { label: 'images this month', left: 0, limit: 150, usedShare: 1, low: true, freeAt: 'More from 10:00am on Sun 20 Sept' },
      { label: 'videos this month', left: 0, limit: 20, usedShare: 1, low: true, freeAt: null },
    ])
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

describe('website fill', () => {
  const details = { businessName: 'Acme Cleaning', description: 'New words', services: [], targetAudience: null, localArea: 'Richmond', tone: 5 }

  it('fills what the website gave, keeps the rest, and lists what changed', () => {
    const draft = draftFromProfile(PROFILE)
    const { draft: next, changed } = applyFindings(draft, { colours: ['#1d4ed8'], logo: null, details })
    expect(next).toMatchObject({ businessName: 'Acme Cleaning', description: 'New words', localArea: 'Richmond', tone: 5, services: PROFILE.services })
    expect(changed).toEqual(['description', 'localArea', 'tone'])
    expect(applyFindings(EMPTY_DRAFT, { colours: [], logo: null, details: null })).toEqual({ draft: EMPTY_DRAFT, changed: [] })
  })

  it('summarises the changes in plain words', () => {
    expect(changedSummary(['logo'])).toBe('Updated from your website: logo. Check them, then save.')
    expect(changedSummary(['businessName', 'services', 'brandColours'])).toBe(
      'Updated from your website: business name, services and colours. Check them, then save.',
    )
  })
})

describe('wrapLines', () => {
  it('breaks words onto lines that fit, never splitting a word', () => {
    const measure = (text: string) => text.length
    expect(wrapLines(measure, 'one two three four', 9)).toEqual(['one two', 'three', 'four'])
    expect(wrapLines(measure, 'extraordinarily long', 5)).toEqual(['extraordinarily', 'long'])
    expect(wrapLines(measure, '  ', 5)).toEqual([])
  })
})

describe('slide design', () => {
  it('uses a photo slide, point slides and a closing slide', () => {
    expect([0, 1, 2, 3, 4].map((i) => slideKind(i, 5))).toEqual(['hook', 'point', 'point', 'point', 'close'])
  })

  it('keeps headings readable on white, swapping pale brand colours for near-black', () => {
    expect(headingColour('#1d4ed8')).toBe('#1d4ed8')
    expect(headingColour('#facc15')).toBe('#111827')
    expect(headingColour('#000000')).toBe('#000000')
  })
})

describe('brand strip', () => {
  it('shows a website address the way an advert would', () => {
    expect(websiteLabel('https://www.acme.co.uk/about?x=1')).toBe('acme.co.uk')
    expect(websiteLabel('  acme.co.uk  ')).toBe('acme.co.uk')
    expect(websiteLabel('')).toBe('')
  })

  it('makes no strip when there is nothing to put on it', async () => {
    expect(await makeBrandStrip({ logoUrl: null, colour: '#1d4ed8', websiteUrl: '' })).toBeNull()
  })

  it('draws the logo and website, then stores it', async () => {
    const drawImage = vi.fn()
    const fillText = vi.fn()
    const context = {
      fillRect: vi.fn(),
      fillText,
      drawImage,
      measureText: () => ({ width: 100 }),
      set font(_value: string) {},
      set fillStyle(_value: string) {},
      set textAlign(_value: string) {},
      set textBaseline(_value: string) {},
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['png'], { type: 'image/png' }))
    })
    class FakeImage {
      onload: (() => void) | null = null
      naturalWidth = 400
      naturalHeight = 100
      set src(_value: string) {
        setTimeout(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ key: 'users/u1/brand/strip.png' }), { headers: { 'Content-Type': 'application/json' } })),
    )

    const key = await uploadBrandStrip({ logoUrl: '/api/files/users/u1/logos/l.png', colour: '#1d4ed8', websiteUrl: 'https://acme.co.uk/' })
    expect(key).toBe('users/u1/brand/strip.png')
    expect(fillText).toHaveBeenCalledWith('acme.co.uk', expect.any(Number), expect.any(Number))
    expect(drawImage).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('carries on without a strip when the browser cannot draw it', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(await uploadBrandStrip({ logoUrl: '/logo.png', colour: null, websiteUrl: 'acme.co.uk' })).toBeNull()
  })
})
