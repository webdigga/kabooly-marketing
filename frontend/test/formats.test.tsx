import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Advert, AdvertVideo } from '../src/lib/types'
import { advert, callsTo, image, json, mockApi, ndjson, PROFILE, renderApp, signedIn, USAGE } from './helpers'

vi.mock('../src/lib/auth-client', async () => ({ authClient: (await import('./auth-mock')).authMock }))
vi.mock('../src/lib/video', () => ({ VIDEO_POLL_MS: 20 }))

const slideRender = vi.hoisted(() => ({
  renderSlide: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  saveBlob: vi.fn(),
}))
vi.mock('../src/lib/slide-render', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...slideRender,
}))

const DONE = { type: 'done', usage: USAGE }

const SLIDES = [
  { heading: 'Is your oven hiding grime?', body: 'Swipe for the signs.' },
  { heading: 'Smoke when you cook', body: 'Old grease burns.' },
  { heading: 'Food tastes odd', body: 'Residue carries flavours.' },
  { heading: 'The door stays grubby', body: 'Glass cleaners cannot shift it.' },
  { heading: 'Book a deep clean', body: 'Visit acme.co.uk.' },
]

const BACKGROUND = { url: '/api/files/users/u1/posts/a1/background-1.jpg', downloadUrl: '/x' }
const START = { url: '/api/files/users/u1/posts/a1/video-start-1.jpg', downloadUrl: '/s' }

function video(status: AdvertVideo['status']): AdvertVideo {
  return {
    status,
    motion: null,
    start: START,
    video: status === 'ready' ? { url: '/api/files/users/u1/posts/a1/video-1.mp4', downloadUrl: '/api/files/v.mp4?download=kabooly-video.mp4' } : null,
  }
}

function base(overrides: Record<string, (req: { body: unknown }) => Response | Promise<Response>> = {}) {
  return {
    'GET /api/profile': () => json({ profile: { ...PROFILE, logoUrl: '/api/files/users/u1/logos/logo.png' } }),
    'GET /api/usage': () => json(USAGE),
    'POST /api/topics/suggest': () => json({ topic: 'Spring ovens' }),
    ...overrides,
  }
}

// happy-dom never loads images from blob URLs, so photos report the size
// the test gives them.
let photoSize = { width: 1600, height: 1200 }
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  set src(value: string) {
    setTimeout(() => {
      if (value.includes('broken')) {
        this.onerror?.()
        return
      }
      this.naturalWidth = photoSize.width
      this.naturalHeight = photoSize.height
      this.onload?.()
    })
  }
}

beforeEach(() => {
  signedIn()
  photoSize = { width: 1600, height: 1200 }
  vi.stubGlobal('Image', FakeImage)
  URL.createObjectURL = vi.fn((blob: Blob) => (blob instanceof File && blob.name.includes('broken') ? 'blob:broken' : 'blob:photo'))
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const PATHS = { images: '/', photo: '/photo', carousel: '/carousel', video: '/video' }

async function landed(format: keyof typeof PATHS) {
  renderApp(PATHS[format])
  await waitFor(() => expect(screen.getByTestId('topic-input')).toHaveValue('Spring ovens'))
}

function photoFile(name = 'garden.jpg', type = 'image/jpeg') {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type })
}

describe('usage', () => {
  it('shows images today and this month, and videos this month', async () => {
    mockApi(base())
    renderApp('/')
    const usage = await screen.findByTestId('usage')
    expect(usage).toHaveTextContent('18 leftimages today of 20')
    expect(usage).toHaveTextContent('138 leftimages this month of 150')
    expect(usage).toHaveTextContent('19 leftvideos this month of 20')
    expect(screen.getByRole('meter', { name: 'images today used' })).toHaveAttribute('aria-valuenow', '2')
  })
})

describe('posts from your own photo', () => {
  const UPLOADED = { key: 'users/u1/uploads/p.jpg', url: '/api/files/users/u1/uploads/p.jpg', width: 1600, height: 1200 }

  it('uploads a photo, then cuts branded images for the ticked platforms', async () => {
    mockApi(
      base({
        'POST /api/uploads/photo': () => json(UPLOADED),
        'POST /api/generations': () =>
          ndjson([{ type: 'advert', advert: advert({ format: 'photo' }) }, { type: 'image', advertId: 'a1', image: image('instagram') }, DONE]),
      }),
    )
    await landed('photo')
    expect(screen.getByText(/at least 1200 pixels on the shortest side/)).toBeInTheDocument()
    expect(screen.getByTestId('generate')).toBeDisabled()
    await userEvent.upload(screen.getByTestId('photo-file'), photoFile())
    expect(await screen.findByTestId('photo-preview')).toHaveAttribute('src', UPLOADED.url)
    await userEvent.click(screen.getByTestId('platform-facebook'))
    await userEvent.click(screen.getByTestId('platform-nextdoor'))
    await userEvent.click(screen.getByTestId('generate'))

    const instagram = await screen.findByTestId('image-instagram')
    await within(instagram).findByRole('img')
    expect(within(instagram).queryByTestId('regenerate-instagram')).not.toBeInTheDocument()
    expect(callsTo('POST', '/api/generations')[0]?.body).toEqual({
      format: 'photo',
      topic: 'Spring ovens',
      platforms: ['instagram'],
      photoKey: UPLOADED.key,
    })
    expect(screen.queryByTestId('photo-preview')).not.toBeInTheDocument()
  })

  it.each([
    ['a photo that is too small', () => photoFile(), { width: 1600, height: 900 }, 'That photo is 1600 × 900 pixels.'],
    ['the wrong type', () => photoFile('photo.heic', 'image/heic'), undefined, 'Choose a JPEG, PNG or WebP photo.'],
    ['an unreadable file', () => photoFile('broken.jpg'), undefined, 'That photo could not be read.'],
  ])('explains %s before uploading', async (_label, file, size, message) => {
    mockApi(base())
    if (size) photoSize = size
    await landed('photo')
    await userEvent.upload(screen.getByTestId('photo-file'), file(), { applyAccept: false })
    expect(await screen.findByText(new RegExp(message.replace(/[.()×]/g, '.')))).toBeInTheDocument()
    expect(callsTo('POST', '/api/uploads/photo')).toHaveLength(0)
  })

  it('refuses a photo over 20 MB, and explains a failed upload', async () => {
    mockApi(base({ 'POST /api/uploads/photo': () => json({ error: 'nope' }, 500) }))
    await landed('photo')
    const big = photoFile()
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 })
    await userEvent.upload(screen.getByTestId('photo-file'), big)
    expect(await screen.findByText('That photo is over 20 MB. Choose a smaller one.')).toBeInTheDocument()
    await userEvent.upload(screen.getByTestId('photo-file'), photoFile())
    expect(await screen.findByText('That photo could not be uploaded. Try again.')).toBeInTheDocument()
  })
})

describe('carousels', () => {
  function carouselRoutes(overrides: Record<string, (req: { body: unknown }) => Response | Promise<Response>> = {}) {
    return base({
      'POST /api/generations': () =>
        ndjson([
          { type: 'advert', advert: advert({ format: 'carousel', slides: SLIDES }) },
          { type: 'background', advertId: 'a1', background: BACKGROUND },
          DONE,
        ]),
      ...overrides,
    })
  }

  it('shows five slides over the background with the logo, and downloads them', async () => {
    mockApi(carouselRoutes())
    await landed('carousel')
    await userEvent.click(screen.getByTestId('generate'))
    const first = await screen.findByTestId('slide-1')
    expect(first).toHaveTextContent('Is your oven hiding grime?')
    expect(first).not.toHaveTextContent('1/5')
    expect(first.querySelector('img')).toBeNull()
    expect(first.getAttribute('style')).toContain(BACKGROUND.url)
    expect(screen.getByTestId('slide-2').getAttribute('style')).toBeNull()
    expect(screen.getByTestId('slide-5').querySelector('img')).toHaveAttribute('src', '/api/files/users/u1/logos/logo.png')
    expect(callsTo('POST', '/api/generations')[0]?.body).toEqual({ format: 'carousel', topic: 'Spring ovens' })
    await waitFor(() => expect(screen.getByTestId('download-slide-2')).toBeEnabled())

    await userEvent.click(screen.getByTestId('download-slide-2'))
    await waitFor(() => expect(slideRender.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'kabooly-slide-2.png'))
    expect(slideRender.renderSlide).toHaveBeenCalledWith(
      { background: BACKGROUND.url, logo: '/api/files/users/u1/logos/logo.png', colour: '#1d4ed8' },
      SLIDES,
      1,
    )
    await userEvent.click(screen.getByTestId('download-all-slides'))
    await waitFor(() => expect(slideRender.saveBlob).toHaveBeenCalledTimes(6))
  })

  it('reports a failed download', async () => {
    mockApi(carouselRoutes())
    slideRender.renderSlide.mockRejectedValueOnce(new Error('no canvas'))
    await landed('carousel')
    await userEvent.click(screen.getByTestId('generate'))
    await userEvent.click(await screen.findByTestId('download-slide-1'))
    expect(await screen.findByText('The slides could not be downloaded. Try again.')).toBeInTheDocument()
  })

  it('edits, rewrites and re-illustrates the slides', async () => {
    const rewritten = SLIDES.map((s) => ({ ...s, heading: `New ${s.heading}` }))
    mockApi(
      carouselRoutes({
        'PATCH /api/posts/a1': ({ body }) => json({ advert: advert({ format: 'carousel', slides: (body as { slides: Advert['slides'] }).slides }) }),
        'POST /api/posts/a1/slides': () => json({ advert: advert({ format: 'carousel', slides: rewritten }) }),
        'POST /api/posts/a1/background': () => json({ background: { ...BACKGROUND, url: '/api/files/b2.jpg' } }),
      }),
    )
    await landed('carousel')
    await userEvent.click(screen.getByTestId('generate'))
    await userEvent.click(await screen.findByTestId('edit-slides'))
    const heading = screen.getByTestId('slide-heading-1')
    await userEvent.clear(heading)
    expect(screen.getByTestId('save-slides')).toBeDisabled()
    await userEvent.type(heading, 'Grimy oven?')
    await userEvent.type(screen.getByTestId('slide-body-1'), ' Now.')
    await userEvent.click(screen.getByTestId('save-slides'))
    await waitFor(() => expect(screen.getByTestId('slide-1')).toHaveTextContent('Grimy oven?'))
    expect(screen.queryByTestId('slide-editor')).not.toBeInTheDocument()
    expect(callsTo('PATCH', '/api/posts/a1')[0]?.body).toEqual({
      slides: [{ heading: 'Grimy oven?', body: 'Swipe for the signs. Now.' }, ...SLIDES.slice(1)],
    })

    await userEvent.click(screen.getByTestId('regenerate-slides'))
    await waitFor(() => expect(screen.getByTestId('slide-2')).toHaveTextContent('New Smoke when you cook'))
    await userEvent.click(screen.getByTestId('regenerate-background'))
    await waitFor(() => expect(screen.getByTestId('slide-1').getAttribute('style')).toContain('/api/files/b2.jpg'))
  })

  it('keeps the slides usable when the background fails, and explains failed changes', async () => {
    mockApi(
      carouselRoutes({
        'POST /api/generations': () =>
          ndjson([
            { type: 'advert', advert: advert({ format: 'carousel', slides: SLIDES }) },
            { type: 'background_error', advertId: 'a1', error: 'x' },
            DONE,
          ]),
        'PATCH /api/posts/a1': () => json({}, 500),
        'POST /api/posts/a1/slides': () => json({}, 502),
        'POST /api/posts/a1/background': () => json({ code: 'daily_image_limit', remaining: 0, limit: 20, nextFreeAt: new Date().toISOString() }, 429),
      }),
    )
    await landed('carousel')
    await userEvent.click(screen.getByTestId('generate'))
    expect(await screen.findByText(/The photo for the first slide could not be made/)).toBeInTheDocument()
    expect(screen.getByTestId('download-slide-1')).toBeEnabled()

    await userEvent.click(screen.getByTestId('edit-slides'))
    await userEvent.click(screen.getByTestId('save-slides'))
    expect(await screen.findByText('Your slides could not be saved. Try again.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await userEvent.click(screen.getByTestId('regenerate-slides'))
    expect(await screen.findByTestId('generator-error')).toHaveTextContent('New slides could not be written')
    await userEvent.click(screen.getByTestId('regenerate-background'))
    await waitFor(() => expect(screen.getByTestId('generator-error')).toHaveTextContent('You have made all 20 images allowed in 24 hours'))
    expect(screen.getByText(/The photo for the first slide could not be made/)).toBeInTheDocument()
  })

  it('treats a stream that stops before the background as a failed background', async () => {
    mockApi(carouselRoutes({ 'POST /api/generations': () => ndjson([{ type: 'advert', advert: advert({ format: 'carousel', slides: SLIDES }) }]) }))
    await landed('carousel')
    await userEvent.click(screen.getByTestId('generate'))
    expect(await screen.findByText(/The photo for the first slide could not be made/)).toBeInTheDocument()
  })
})

describe('videos', () => {
  it('writes the advert, starts the video with the movement, and shows it once made', async () => {
    let checks = 0
    mockApi(
      base({
        'POST /api/generations': () => ndjson([{ type: 'advert', advert: advert() }, DONE]),
        'POST /api/posts/a1/video': () => json({ video: video('pending'), usage: { ...USAGE, videosThisMonth: { used: 2, limit: 20, nextFreeAt: null } } }, 202),
        'GET /api/posts/a1/video': () => {
          checks += 1
          if (checks === 1) return json({}, 500)
          return json({ video: video(checks === 2 ? 'pending' : 'ready') })
        },
      }),
    )
    await landed('video')
    await userEvent.type(screen.getByTestId('create-motion'), 'Steam rises')
    await userEvent.click(screen.getByTestId('generate'))

    expect(await screen.findByTestId('video-progress')).toBeInTheDocument()
    expect(screen.getByText(/Planning the shots and captions/)).toBeInTheDocument()
    expect(callsTo('POST', '/api/generations')[0]?.body).toEqual({ format: 'images', topic: 'Spring ovens', platforms: [] })
    expect(callsTo('POST', '/api/posts/a1/video')[0]?.body).toEqual({ motion: 'Steam rises' })
    expect(screen.getByTestId('usage')).toHaveTextContent('18 leftvideos this month')

    expect(await screen.findByTestId('video-player')).toHaveAttribute('src', '/api/files/users/u1/posts/a1/video-1.mp4')
    expect(screen.getByRole('link', { name: 'Download video' })).toHaveAttribute('href', video('ready').video?.downloadUrl)
    expect(checks).toBe(3)
    expect(screen.getByTestId('make-video')).toHaveTextContent('Make a new video')
  })

  it('explains the monthly video limit and lets the customer try again', async () => {
    const nextFreeAt = new Date(Date.now() + 3 * 86_400_000).toISOString()
    mockApi(
      base({
        'POST /api/generations': () => ndjson([{ type: 'advert', advert: advert() }, DONE]),
        'POST /api/posts/a1/video': () => json({ code: 'monthly_video_limit', limit: 20, remaining: 0, nextFreeAt }, 429),
      }),
    )
    await landed('video')
    await userEvent.click(screen.getByTestId('generate'))
    expect(await screen.findByTestId('video-error')).toHaveTextContent('You have made all 20 videos allowed in 30 days')
    expect(callsTo('POST', '/api/posts/a1/video')[0]?.body).toEqual({ motion: null })
    await userEvent.click(screen.getByTestId('make-video'))
    await waitFor(() => expect(callsTo('POST', '/api/posts/a1/video')).toHaveLength(2))
  })
})

describe('library', () => {
  it('shows a carousel background or video frame as the thumbnail', async () => {
    mockApi(
      base({
        'GET /api/posts': () =>
          json({
            adverts: [
              advert({ id: 'c1', format: 'carousel', slides: SLIDES, background: BACKGROUND }),
              advert({ id: 'v1', video: video('ready') }),
              advert({ id: 'v2', video: video('pending') }),
            ],
            nextCursor: null,
          }),
      }),
    )
    renderApp('/library')
    const cards = await screen.findAllByTestId('library-card')
    expect(cards[0]!.querySelector('img')).toHaveAttribute('src', BACKGROUND.url)
    expect(cards[0]).toHaveTextContent('Carousel')
    expect(cards[1]!.querySelector('img')).toHaveAttribute('src', START.url)
    expect(cards[1]).toHaveTextContent('Video')
    expect(cards[2]).not.toHaveTextContent('Video')
  })

  it('opens a carousel with its slides, which can be edited', async () => {
    mockApi(
      base({
        'GET /api/posts/c1': () => json({ advert: advert({ id: 'c1', format: 'carousel', slides: SLIDES, background: null }) }),
        'PATCH /api/posts/c1': () => json({ advert: advert({ id: 'c1', format: 'carousel', slides: SLIDES.map((s) => ({ ...s, body: 'Edited' })) }) }),
      }),
    )
    renderApp('/library/c1')
    expect(await screen.findByTestId('slide-5')).toHaveTextContent('Book a deep clean')
    expect(screen.queryByTestId('regenerate-background')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('edit-slides'))
    await userEvent.click(screen.getByTestId('save-slides'))
    await waitFor(() => expect(screen.getByTestId('slide-1')).toHaveTextContent('Edited'))
  })

  it('makes a video from any saved advert, and says when one failed', async () => {
    mockApi(
      base({
        'GET /api/posts/a1': () => json({ advert: advert({ video: video('failed') }) }),
        'POST /api/posts/a1/video': () => json({}, 502),
      }),
    )
    renderApp('/library/a1')
    const panel = await screen.findByTestId('library-video')
    expect(within(panel).getByText(/That video could not be made, so it has not counted/)).toBeInTheDocument()
    expect(within(panel).queryByTestId('video-motion')).not.toBeInTheDocument()
    await userEvent.click(within(panel).getByTestId('make-video'))
    expect(await within(panel).findByTestId('video-error')).toHaveTextContent('The video could not be started. Try again.')
    expect(callsTo('POST', '/api/posts/a1/video')[0]?.body).toEqual({ motion: null })
  })
})
