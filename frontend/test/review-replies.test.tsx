import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callsTo, json, mockApi, PROFILE, renderApp, signedIn, USAGE } from './helpers'

vi.mock('../src/lib/auth-client', async () => ({ authClient: (await import('./auth-mock')).authMock }))

const writeText = vi.fn(async () => undefined)

const base = {
  'GET /api/profile': () => json({ profile: PROFILE }),
  'GET /api/usage': () => json(USAGE),
}

const REVIEWS = {
  place: 'Acme Cleaning, Twickenham',
  reviews: [
    { id: 'r1', author: 'Jane Clark', rating: 5, comment: 'Spotless oven, booked again.', at: '2026-10-01T10:00:00Z', reply: null },
    { id: 'r2', author: 'Sam', rating: 2, comment: 'Turned up late.', at: '2026-09-20T10:00:00Z', reply: 'Sorry about that, Sam.' },
    { id: 'r3', author: 'A customer', rating: 4, comment: null, at: '2026-09-18T10:00:00Z', reply: null },
  ],
}

beforeEach(() => {
  signedIn()
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('your reviews', () => {
  it('lists the reviews, counts what is waiting and shows replies already sent', async () => {
    mockApi({ ...base, 'GET /api/reviews': () => json(REVIEWS) })
    renderApp('/reviews')
    const list = await screen.findByTestId('reviews-list')
    expect(within(list).getByText('Acme Cleaning, Twickenham')).toBeInTheDocument()
    expect(within(list).getByText('2 reviews are waiting for a reply.')).toBeInTheDocument()
    expect(within(screen.getByTestId('review-r1')).getByLabelText('5 out of 5')).toBeInTheDocument()
    expect(within(screen.getByTestId('review-r3')).getByText('A rating with no words.')).toBeInTheDocument()
    // One already answered, so no draft button on it.
    const answered = screen.getByTestId('review-r2')
    expect(within(answered).getByText('Sorry about that, Sam.')).toBeInTheDocument()
    expect(within(answered).queryByTestId('draft-r2')).not.toBeInTheDocument()
  })

  it('drafts a reply, lets it be edited, copied and rewritten, and never posts it', async () => {
    let reply = 'Thanks Jane, glad the oven came up well. See you next time.'
    mockApi({
      ...base,
      'GET /api/reviews': () => json(REVIEWS),
      'POST /api/reviews/reply': () => json({ reply }),
    })
    renderApp('/reviews')
    await userEvent.click(await screen.findByTestId('draft-r1'))
    const box = await screen.findByTestId('reply-r1')
    expect(box).toHaveValue('Thanks Jane, glad the oven came up well. See you next time.')
    expect(callsTo('POST', '/api/reviews/reply')[0]?.body).toEqual({
      author: 'Jane Clark',
      rating: 5,
      comment: 'Spotless oven, booked again.',
    })

    await userEvent.type(box, ' Thank you.')
    await userEvent.click(screen.getByTestId('copy-r1'))
    expect(writeText).toHaveBeenCalledWith('Thanks Jane, glad the oven came up well. See you next time. Thank you.')

    reply = 'Thanks Jane, that is good to hear.'
    await userEvent.click(screen.getByTestId('rewrite-r1'))
    expect(await screen.findByTestId('reply-r1')).toHaveValue('Thanks Jane, that is good to hear.')
  })

  it('says what to do when Business Profile is not connected', async () => {
    mockApi({ ...base, 'GET /api/reviews': () => json({ error: 'nope', code: 'not_connected' }, 409) })
    renderApp('/reviews')
    expect(await within(await screen.findByTestId('reviews-blocked')).findByText(/Connect Google Business Profile/)).toBeInTheDocument()
    expect(screen.queryByTestId('reviews-list')).not.toBeInTheDocument()
  })

  it('reports a failed draft without losing the review', async () => {
    mockApi({
      ...base,
      'GET /api/reviews': () => json(REVIEWS),
      'POST /api/reviews/reply': () => json({ error: 'That reply could not be written. Try again.' }, 502),
    })
    renderApp('/reviews')
    await userEvent.click(await screen.findByTestId('draft-r1'))
    expect(await screen.findByText('That reply could not be written. Try again.')).toBeInTheDocument()
    expect(screen.getByTestId('review-r1')).toBeInTheDocument()
  })

  it('offers a retry when the reviews cannot be loaded, and copes with none at all', async () => {
    let fail = true
    mockApi({ ...base, 'GET /api/reviews': () => (fail ? json({}, 500) : json({ place: 'Acme', reviews: [] })) })
    renderApp('/reviews')
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/No reviews yet/)).toBeInTheDocument()
    expect(screen.getByText('0 reviews are waiting for a reply.')).toBeInTheDocument()
  })
})
