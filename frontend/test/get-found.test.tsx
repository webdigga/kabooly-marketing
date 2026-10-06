import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi, PROFILE, renderApp, signedIn, USAGE } from './helpers'

vi.mock('../src/lib/auth-client', async () => ({ authClient: (await import('./auth-mock')).authMock }))

const base = {
  'GET /api/profile': () => json({ profile: PROFILE }),
  'GET /api/usage': () => json(USAGE),
}

const OVERVIEW = {
  site: 'sc-domain:acme-cleaning.co.uk',
  period: { start: '2026-09-08', end: '2026-10-03' },
  totals: { clicks: 120, impressions: 4000, position: 12.3 },
  before: { clicks: 90, impressions: 4000, position: 15 },
  topQueries: [{ query: 'oven cleaning twickenham', clicks: 80, impressions: 900, position: 2.1 }],
  nearly: [{ query: 'end of tenancy clean', clicks: 5, impressions: 1200, position: 14.6 }],
  slipped: [{ page: 'https://acme-cleaning.co.uk/ovens', position: 9.5, was: 4 }],
}

beforeEach(() => {
  signedIn()
})

describe('get found', () => {
  it('shows the figures, how they moved, what is nearly there and what slipped', async () => {
    mockApi({ ...base, 'GET /api/search-console/overview': () => json(OVERVIEW) })
    renderApp('/get-found')
    const figures = await screen.findByTestId('search-figures')
    expect(figures).toHaveTextContent('120')
    expect(figures).toHaveTextContent('30 better')
    // Impressions held steady, and a lower average position is an improvement.
    expect(figures).toHaveTextContent('no change')
    expect(figures).toHaveTextContent('2.7 better')

    expect(within(screen.getByTestId('search-nearly')).getByText('end of tenancy clean')).toBeInTheDocument()
    expect(within(screen.getByTestId('search-queries')).getByText('oven cleaning twickenham')).toBeInTheDocument()
    const slipped = screen.getByTestId('search-slipped')
    expect(within(slipped).getByText('/ovens')).toBeInTheDocument()
    expect(within(slipped).getByText(/place 4 to 9.5/)).toBeInTheDocument()
  })

  it('says what to do when there is no connection, and leaves out sections with nothing in them', async () => {
    mockApi({
      ...base,
      'GET /api/search-console/overview': () => json({ error: 'nope', code: 'not_connected' }, 409),
    })
    renderApp('/get-found')
    const blocked = await screen.findByTestId('search-blocked')
    expect(within(blocked).getByText(/Connect Google Search Console in Settings/)).toBeInTheDocument()
    expect(screen.queryByTestId('search-figures')).not.toBeInTheDocument()
    await userEvent.click(within(blocked).getByRole('link', { name: 'Go to Settings' }))
    await screen.findByRole('heading', { name: 'Settings' })
  })

  it('offers a retry when the figures cannot be loaded', async () => {
    let fail = true
    mockApi({
      ...base,
      'GET /api/search-console/overview': () => (fail ? json({}, 500) : json({ ...OVERVIEW, nearly: [], topQueries: [], slipped: [] })),
    })
    renderApp('/get-found')
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/Nothing close enough to nudge yet/)).toBeInTheDocument()
    expect(screen.getByText(/has not recorded any searches yet/)).toBeInTheDocument()
    expect(screen.queryByTestId('search-slipped')).not.toBeInTheDocument()
  })
})
