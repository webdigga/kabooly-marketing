import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { advert, callsTo, image, json, mockApi, ndjson, PROFILE, renderApp, signedIn, USAGE } from './helpers'

vi.mock('../src/lib/auth-client', async () => ({ authClient: (await import('./auth-mock')).authMock }))

const DONE = { type: 'done', usage: { ...USAGE, imagesToday: { used: 4, limit: 20, nextFreeAt: null } } }

function stream(platforms: ('instagram' | 'facebook' | 'nextdoor')[] = ['instagram', 'facebook']) {
  return () =>
    ndjson([
      { type: 'advert', advert: advert() },
      ...platforms.map((p) => ({ type: 'image', advertId: 'a1', image: image(p) })),
      DONE,
    ])
}

let topicCount = 0

function routes(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  topicCount = 0
  return {
    'GET /api/profile': () => json({ profile: PROFILE }),
    'GET /api/usage': () => json(USAGE),
    'POST /api/topics/suggest': () => {
      topicCount += 1
      return json({ topic: topicCount === 1 ? 'Spring ovens' : 'Sparkling windows' })
    },
    'POST /api/generations': stream(),
    ...overrides,
  }
}

beforeEach(() => {
  signedIn()
  mockApi(routes())
})

async function landed() {
  renderApp('/')
  await waitFor(() => expect(screen.getByTestId('topic-input')).toHaveValue('Spring ovens'))
}

describe('topic', () => {
  it('suggests a topic on landing and another on request, avoiding repeats', async () => {
    await landed()
    expect(screen.getByTestId('usage')).toHaveTextContent('18 of 20 images left')
    await userEvent.click(screen.getByTestId('suggest-topic'))
    await waitFor(() => expect(screen.getByTestId('topic-input')).toHaveValue('Sparkling windows'))
    expect(callsTo('POST', '/api/topics/suggest')[1]?.body).toEqual({ avoid: ['Spring ovens'] })
  })

  it('lets the user write their own topic', async () => {
    await landed()
    await userEvent.clear(screen.getByTestId('topic-input'))
    await userEvent.type(screen.getByTestId('topic-input'), 'Gutter clearing')
    await userEvent.click(screen.getByTestId('generate'))
    await screen.findByTestId('result')
    expect(callsTo('POST', '/api/generations')[0]?.body).toMatchObject({ topic: 'Gutter clearing' })
  })

  it('still works by hand when suggestions fail', async () => {
    mockApi(routes({ 'POST /api/topics/suggest': () => json({}, 502) }))
    renderApp('/')
    expect(await screen.findByText(/Could not suggest a topic/)).toBeInTheDocument()
    expect(screen.getByTestId('generate')).toBeDisabled()
    await userEvent.type(screen.getByTestId('topic-input'), 'Oven cleaning')
    expect(screen.getByTestId('generate')).toBeEnabled()
  })
})

describe('generation', () => {
  it('shows the text, then a labelled image with download for each ticked platform', async () => {
    await landed()
    await userEvent.click(screen.getByTestId('platform-nextdoor'))
    await userEvent.click(screen.getByTestId('generate'))

    expect(await screen.findByTestId('post-text')).toHaveValue('Book your spring oven clean in Twickenham.')
    const instagram = await screen.findByTestId('image-instagram')
    expect(within(instagram).getByText('Instagram')).toBeInTheDocument()
    expect(within(instagram).getByText('1080 × 1080')).toBeInTheDocument()
    expect(within(instagram).getByRole('link', { name: 'Download' })).toHaveAttribute('href', image('instagram').downloadUrl)
    expect(screen.getByTestId('image-facebook')).toBeInTheDocument()
    expect(screen.queryByTestId('image-nextdoor')).not.toBeInTheDocument()
    expect(callsTo('POST', '/api/generations')[0]?.body).toEqual({ format: 'images', topic: 'Spring ovens', platforms: ['instagram', 'facebook'] })
    expect(screen.getByTestId('usage')).toHaveTextContent('16 of 20 images left')
    expect(localStorage.getItem('kabooly-marketing-platforms')).toBe('["instagram","facebook"]')
  })

  it('makes a text-only advert when nothing is ticked', async () => {
    mockApi(routes({ 'POST /api/generations': stream([]) }))
    await landed()
    for (const p of ['instagram', 'facebook', 'nextdoor']) await userEvent.click(screen.getByTestId(`platform-${p}`))
    await userEvent.click(screen.getByTestId('generate'))
    await screen.findByTestId('post-text')
    expect(screen.queryByTestId('image-instagram')).not.toBeInTheDocument()
  })

  it('explains the daily limit', async () => {
    const nextFreeAt = new Date(Date.now() + 60 * 60_000).toISOString()
    mockApi(
      routes({
        'POST /api/generations': () =>
          json({ error: 'Daily limit reached.', code: 'daily_image_limit', limit: 20, remaining: 0, nextFreeAt }, 429),
      }),
    )
    await landed()
    await userEvent.click(screen.getByTestId('generate'))
    expect(await screen.findByTestId('generator-error')).toHaveTextContent('You have made all 20 images allowed in 24 hours')
  })

  it('shows a failed image with a retry, and regenerates just that one', async () => {
    mockApi(
      routes({
        'POST /api/generations': () =>
          ndjson([
            { type: 'advert', advert: advert() },
            { type: 'image', advertId: 'a1', image: image('instagram') },
            { type: 'image_error', advertId: 'a1', platform: 'facebook', error: 'This image could not be made. Try regenerating it.' },
            DONE,
          ]),
        'POST /api/posts/a1/images/facebook': () => json({ image: image('facebook', 2) }),
      }),
    )
    await landed()
    await userEvent.click(screen.getByTestId('generate'))
    const facebook = await screen.findByTestId('image-facebook')
    expect(within(facebook).getByRole('alert')).toHaveTextContent('This image could not be made')
    await userEvent.click(within(facebook).getByTestId('regenerate-facebook'))
    await waitFor(() => expect(within(facebook).getByRole('img')).toHaveAttribute('src', image('facebook', 2).url))
    expect(callsTo('POST', '/api/posts/a1/images/instagram')).toHaveLength(0)
  })

  it('reports a regeneration refused by the rate limit', async () => {
    const retryAt = new Date(Date.now() + 30_000).toISOString()
    mockApi(
      routes({
        'POST /api/posts/a1/images/instagram': () => json({ code: 'rate_limit', retryAt }, 429),
      }),
    )
    await landed()
    await userEvent.click(screen.getByTestId('generate'))
    const instagram = await screen.findByTestId('image-instagram')
    await within(instagram).findByRole('img')
    await userEvent.click(within(instagram).getByTestId('regenerate-instagram'))
    expect(await within(instagram).findByText(/That is a lot of adverts in one minute/)).toBeInTheDocument()
  })

  it('reports text that could not be written', async () => {
    mockApi(routes({ 'POST /api/generations': () => ndjson([{ type: 'error', error: 'The advert could not be written. Try again.' }, DONE]) }))
    await landed()
    await userEvent.click(screen.getByTestId('generate'))
    expect(await screen.findByTestId('generator-error')).toHaveTextContent('The advert could not be written')
  })

  it('never leaves an image spinning if the stream stops early', async () => {
    mockApi(routes({ 'POST /api/generations': () => ndjson([{ type: 'advert', advert: advert() }]) }))
    await landed()
    await userEvent.click(screen.getByTestId('generate'))
    const instagram = await screen.findByTestId('image-instagram')
    expect(await within(instagram).findByRole('alert')).toHaveTextContent('did not arrive')
    expect(screen.getByTestId('generate')).toBeEnabled()
  })
})

describe('editing text', () => {
  it('saves edits in place and copies what is on screen', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mockApi(
      routes({
        'PATCH /api/posts/a1': () => json({ advert: advert({ body: 'My own words.' }) }),
      }),
    )
    await landed()
    await userEvent.click(screen.getByTestId('generate'))
    const text = await screen.findByTestId('post-text')
    await userEvent.clear(text)
    await userEvent.type(text, 'My own words.')
    await userEvent.click(screen.getByTestId('copy-text'))
    expect(writeText).toHaveBeenCalledWith('My own words.')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('save-text'))
    await waitFor(() => expect(screen.queryByTestId('save-text')).not.toBeInTheDocument())
    expect(callsTo('PATCH', '/api/posts/a1')[0]?.body).toEqual({ body: 'My own words.' })
  })

  it('regenerates the text without touching the images', async () => {
    mockApi(routes({ 'POST /api/posts/a1/text': () => json({ advert: advert({ body: 'A fresh take.' }) }) }))
    await landed()
    await userEvent.click(screen.getByTestId('generate'))
    await screen.findByTestId('image-instagram')
    await userEvent.click(screen.getByTestId('regenerate-text'))
    await waitFor(() => expect(screen.getByTestId('post-text')).toHaveValue('A fresh take.'))
    expect(within(screen.getByTestId('image-instagram')).getByRole('img')).toHaveAttribute('src', image('instagram').url)
  })

  it('explains a failed save and a failed regeneration', async () => {
    mockApi(
      routes({
        'PATCH /api/posts/a1': () => json({}, 500),
        'POST /api/posts/a1/text': () => json({}, 502),
      }),
    )
    await landed()
    await userEvent.click(screen.getByTestId('generate'))
    const text = await screen.findByTestId('post-text')
    await userEvent.type(text, ' More.')
    await userEvent.click(screen.getByTestId('save-text'))
    expect(await screen.findByText('Your changes could not be saved. Try again.')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Undo changes'))
    await userEvent.click(screen.getByTestId('regenerate-text'))
    expect(await screen.findByTestId('generator-error')).toHaveTextContent('New text could not be written')
  })
})
