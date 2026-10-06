import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callsTo, json, mockApi, PROFILE, renderApp, signedIn, USAGE } from './helpers'

vi.mock('../src/lib/auth-client', async () => ({ authClient: (await import('./auth-mock')).authMock }))

// happy-dom has no canvas, so the QR drawing is stood in for.
const qr = vi.hoisted(() => ({ drawQrCode: vi.fn(async () => undefined), saveQrCode: vi.fn() }))
vi.mock('../src/lib/qr', () => qr)

const writeText = vi.fn(async () => undefined)

const base = {
  'GET /api/profile': () => json({ profile: PROFILE }),
  'GET /api/usage': () => json(USAGE),
}

const URL_FOR = 'http://localhost/r/abc2345'
const MESSAGE = `Thanks for choosing Acme Cleaning.\n\nIf we did a good job, would you leave us a quick Google review?\n\n${URL_FOR}`

interface RequestJson {
  link: { slug: string; target: string } | null
  url: string | null
  message: string | null
}

function saved(): RequestJson {
  return {
    link: { slug: 'abc2345', target: 'https://g.page/r/acme/review' },
    url: URL_FOR,
    message: MESSAGE,
  }
}

beforeEach(() => {
  signedIn()
  qr.drawQrCode.mockClear()
  qr.saveQrCode.mockClear()
  writeText.mockClear()
  // navigator.clipboard is read-only in happy-dom.
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('asking for reviews', () => {
  it('saves the Google link, then shows the short link, the QR code and the message', async () => {
    let stored: RequestJson = { link: null, url: null, message: null }
    mockApi({
      ...base,
      'GET /api/review-request': () => json(stored),
      'PUT /api/review-link': () => {
        stored = saved()
        return json({ link: stored.link })
      },
    })
    renderApp('/reviews')
    expect(await screen.findByTestId('review-empty')).toBeInTheDocument()
    expect(screen.getByTestId('save-review-link')).toBeDisabled()

    await userEvent.type(screen.getByTestId('review-target-input'), 'https://g.page/r/acme/review')
    await userEvent.click(screen.getByTestId('save-review-link'))

    expect(await screen.findByTestId('review-url')).toHaveTextContent(URL_FOR)
    expect(callsTo('PUT', '/api/review-link')[0]?.body).toEqual({ target: 'https://g.page/r/acme/review' })
    expect(qr.drawQrCode).toHaveBeenCalledWith(expect.anything(), URL_FOR)
    expect(screen.getByTestId('review-message-text')).toHaveValue(MESSAGE)
    expect(screen.queryByTestId('review-empty')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('download-qr'))
    expect(qr.saveQrCode).toHaveBeenCalledWith(expect.anything(), 'kabooly-review-qr.png')
  })

  it('copies the link and the message', async () => {
    mockApi({ ...base, 'GET /api/review-request': () => json(saved()) })
    renderApp('/reviews')
    await userEvent.click(await screen.findByTestId('copy-url'))
    expect(writeText).toHaveBeenCalledWith(URL_FOR)
    expect(await within(screen.getByTestId('review-link')).findByText('Copied')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('copy-message'))
    expect(writeText).toHaveBeenCalledWith(MESSAGE)
  })

  it('repeats what the worker says about a link that is not a Google one', async () => {
    mockApi({
      ...base,
      'GET /api/review-request': () => json({ link: null, url: null, message: null }),
      'PUT /api/review-link': () => json({ error: 'That is not a Google address.', code: 'not_google' }, 400),
    })
    renderApp('/reviews')
    await userEvent.type(await screen.findByTestId('review-target-input'), 'https://example.com/leave-a-review')
    await userEvent.click(screen.getByTestId('save-review-link'))
    expect(await screen.findByText('That is not a Google address.')).toBeInTheDocument()
  })

  it('offers a retry when the link cannot be loaded', async () => {
    let fail = true
    mockApi({ ...base, 'GET /api/review-request': () => (fail ? json({}, 500) : json(saved())) })
    renderApp('/reviews')
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('review-url')).toHaveTextContent(URL_FOR)
  })

  it('says so when the QR code cannot be drawn', async () => {
    qr.drawQrCode.mockRejectedValueOnce(new Error('no canvas'))
    mockApi({ ...base, 'GET /api/review-request': () => json(saved()) })
    renderApp('/reviews')
    expect(await screen.findByText(/QR code could not be drawn/)).toBeInTheDocument()
  })
})
