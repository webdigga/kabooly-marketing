import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { advert, authMock, callsTo, image, json, mockApi, PROFILE, renderApp, signedIn, USAGE } from './helpers'

vi.mock('../src/lib/auth-client', async () => ({ authClient: (await import('./auth-mock')).authMock }))

const base = {
  'GET /api/profile': () => json({ profile: PROFILE }),
  'GET /api/usage': () => json(USAGE),
  'POST /api/topics/suggest': () => json({ topic: 'Spring ovens' }),
}

beforeEach(() => {
  signedIn()
})

describe('library', () => {
  it('lists adverts newest first with copy and downloads, and loads older ones', async () => {
    mockApi({
      ...base,
      'GET /api/adverts': ({ url }) =>
        url.includes('before=')
          ? json({ adverts: [advert({ id: 'a0', topic: 'Old news', createdAt: '2026-09-01T09:00:00.000Z' })], nextCursor: null })
          : json({ adverts: [advert({ images: [image('facebook')] })], nextCursor: 'cursor-1' }),
    })
    renderApp('/library')
    const first = await screen.findByTestId('library-advert')
    expect(within(first).getByRole('heading', { name: 'Spring ovens' })).toBeInTheDocument()
    expect(within(first).getByText('15 September 2026')).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: 'Copy text' })).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: 'Download' })).toHaveAttribute('href', image('facebook').downloadUrl)
    expect(within(first).queryByTestId('regenerate-facebook')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('load-more'))
    await screen.findByText('Old news')
    expect(screen.getAllByTestId('library-advert')).toHaveLength(2)
    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument()
    expect(callsTo('GET', '/api/adverts')[1]?.url).toBe('/api/adverts?before=cursor-1')
  })

  it('shows an empty state that leads to the generator', async () => {
    mockApi({ ...base, 'GET /api/adverts': () => json({ adverts: [], nextCursor: null }) })
    renderApp('/library')
    await screen.findByText('No adverts yet')
    await userEvent.click(screen.getByRole('link', { name: 'Create your first advert' }))
    await screen.findByRole('heading', { name: 'Create an advert' })
  })

  it('offers a retry when loading fails', async () => {
    let fail = true
    mockApi({
      ...base,
      'GET /api/adverts': () => (fail ? json({}, 500) : json({ adverts: [], nextCursor: 'c' })),
    })
    renderApp('/library')
    await screen.findByText('Could not load your adverts.')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('No adverts yet')
    fail = true
    await userEvent.click(screen.getByTestId('load-more'))
    expect(await screen.findByText('Could not load more adverts. Try again.')).toBeInTheDocument()
  })
})

describe('settings', () => {
  function settingsRoutes(scanColours: string[] = ['#16a34a']) {
    return {
      ...base,
      'PUT /api/profile': ({ body }: { body: unknown }) => json({ profile: { ...PROFILE, ...(body as object), logoUrl: null } }),
      'POST /api/profile/scan': () =>
        json({ websiteUrl: 'https://acme.co.uk/', reachable: true, colours: scanColours, logo: null, logoSvg: null }),
    }
  }

  it('edits and saves the profile', async () => {
    mockApi(settingsRoutes())
    renderApp('/settings')
    const name = await screen.findByTestId('business-name')
    expect(name).toHaveValue('Acme Cleaning')
    await userEvent.clear(name)
    await userEvent.type(name, 'Acme Cleaning Ltd')
    await userEvent.click(screen.getByLabelText('Formal'))
    await userEvent.click(screen.getByTestId('save-profile'))
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
    expect(callsTo('PUT', '/api/profile')[0]?.body).toMatchObject({ businessName: 'Acme Cleaning Ltd', tone: 1 })
  })

  it('validates before saving and reports a failed save', async () => {
    mockApi({ ...settingsRoutes(), 'PUT /api/profile': () => json({}, 500) })
    renderApp('/settings')
    const area = await screen.findByTestId('local-area')
    await userEvent.clear(area)
    await userEvent.click(screen.getByTestId('save-profile'))
    expect(screen.getByText('Enter the area you cover.')).toBeInTheDocument()
    expect(callsTo('PUT', '/api/profile')).toHaveLength(0)
    await userEvent.type(area, 'Richmond')
    await userEvent.click(screen.getByTestId('save-profile'))
    expect(await screen.findByText(/could not be saved/)).toBeInTheDocument()
  })

  it('fetches colours from the website on request and lets them be edited', async () => {
    mockApi(settingsRoutes())
    renderApp('/settings')
    await screen.findByTestId('business-name')
    await userEvent.click(screen.getByTestId('fetch-website'))
    await waitFor(() => expect(screen.getByTestId('colour-hex-0')).toHaveValue('#16a34a'))
    const hex = screen.getByTestId('colour-hex-0')
    await userEvent.clear(hex)
    await userEvent.type(hex, 'ff0000')
    await userEvent.click(screen.getByTestId('save-profile'))
    await screen.findByText('Profile saved.')
    expect(callsTo('PUT', '/api/profile')[0]?.body).toMatchObject({ brandColours: ['#ff0000'] })
  })

  it('asks for a website before fetching', async () => {
    mockApi(settingsRoutes())
    renderApp('/settings')
    await userEvent.clear(await screen.findByTestId('website'))
    await userEvent.click(screen.getByTestId('fetch-website'))
    expect(screen.getByText('Enter your website first.')).toBeInTheDocument()
    expect(callsTo('POST', '/api/profile/scan')).toHaveLength(0)
  })

  it('uploads a replacement logo and refuses the wrong file type', async () => {
    mockApi({
      ...settingsRoutes(),
      'POST /api/uploads/logo': () => json({ key: 'users/u1/logos/new.png', url: '/api/files/users/u1/logos/new.png' }),
    })
    renderApp('/settings')
    const input = await screen.findByTestId('logo-file')
    await userEvent.upload(input, new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByAltText('Your logo')).toHaveAttribute('src', '/api/files/users/u1/logos/new.png'))
    await userEvent.upload(input, new File(['x'], 'logo.gif', { type: 'image/gif' }), { applyAccept: false })
    expect(await screen.findByText('Choose a PNG, JPEG, WebP or SVG image.')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('remove-logo'))
    expect(screen.getByLabelText('No logo')).toBeInTheDocument()
  })

  it('signs out', async () => {
    mockApi(settingsRoutes())
    renderApp('/settings')
    await userEvent.click(await screen.findByTestId('sign-out'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sign-in'))
    expect(authMock.signOut).toHaveBeenCalled()
  })
})

describe('loading the account', () => {
  it('offers a retry when the profile cannot load', async () => {
    let fail = true
    mockApi({ ...base, 'GET /api/profile': () => (fail ? json({}, 500) : json({ profile: PROFILE })) })
    renderApp('/')
    await screen.findByText(/Could not load your account/)
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: 'Create an advert' })
  })
})
