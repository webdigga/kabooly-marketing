import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { advert, authMock, callsTo, image, json, mockApi, ndjson, PROFILE, renderApp, signedIn, USAGE } from './helpers'

vi.mock('../src/lib/auth-client', async () => ({ authClient: (await import('./auth-mock')).authMock }))

const base = {
  'GET /api/profile': () => json({ profile: PROFILE }),
  'GET /api/usage': () => json(USAGE),
  'POST /api/topics/suggest': () => json({ topic: 'Spring ovens' }),
}

beforeEach(() => {
  signedIn()
})

describe('navigation', () => {
  it('moves between the four things you can make, the library and settings', async () => {
    mockApi({ ...base, 'GET /api/posts': () => json({ adverts: [], nextCursor: null }) })
    renderApp('/')
    await screen.findByRole('heading', { name: 'Image advert' })
    for (const [label, heading] of [
      ['Photo post', 'Photo post'],
      ['Carousel', 'Carousel'],
      ['Video', 'Video'],
      ['Library', 'Library'],
      ['Settings', 'Settings'],
      ['Image advert', 'Image advert'],
    ]) {
      // The same links appear in the sidebar and in the phone tab row.
      await userEvent.click(screen.getAllByRole('link', { name: label })[0]!)
      await screen.findByRole('heading', { name: heading })
    }
  })
})

describe('switching between pages', () => {
  it('starts each page fresh, without the last result', async () => {
    mockApi({
      ...base,
      'POST /api/generations': () => ndjson([{ type: 'advert', advert: advert() }, { type: 'done', usage: USAGE }]),
    })
    renderApp('/')
    await waitFor(() => expect(screen.getByTestId('topic-input')).toHaveValue('Spring ovens'))
    await userEvent.click(screen.getByTestId('generate'))
    await screen.findByTestId('result')
    await userEvent.click(screen.getAllByRole('link', { name: 'Carousel' })[0]!)
    await screen.findByRole('heading', { name: 'Carousel' })
    expect(screen.queryByTestId('result')).not.toBeInTheDocument()
  })
})

describe('the phone menu', () => {
  it('opens behind the menu button and closes when a page is chosen', async () => {
    mockApi(base)
    renderApp('/')
    await screen.findByRole('heading', { name: 'Image advert' })
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('menu-button'))
    const menu = screen.getByRole('navigation', { name: 'Main' })
    expect(screen.getByTestId('menu-button')).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(within(menu).getByRole('link', { name: 'Carousel' }))
    await screen.findByRole('heading', { name: 'Carousel' })
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })
})

describe('library', () => {
  it('shows adverts as a compact grid, newest first, and loads older ones', async () => {
    mockApi({
      ...base,
      'GET /api/posts': ({ url }) =>
        url.includes('before=')
          ? json({ adverts: [advert({ id: 'a0', topic: 'Old news', createdAt: '2026-09-01T09:00:00.000Z' })], nextCursor: null })
          : json({ adverts: [advert({ images: [image('facebook'), image('instagram')] })], nextCursor: 'cursor-1' }),
    })
    renderApp('/library')
    const [first] = await screen.findAllByTestId('library-card')
    expect(first).toHaveAttribute('href', '/library/a1')
    expect(within(first!).getByText('Spring ovens')).toBeInTheDocument()
    expect(within(first!).getByText(/15 Sept 2026 · Facebook, Instagram/)).toBeInTheDocument()
    // The square Instagram image is the thumbnail, not the landscape one.
    expect(first!.querySelector('img')).toHaveAttribute('src', image('instagram').url)

    await userEvent.click(screen.getByTestId('load-more'))
    await screen.findByText('Old news')
    const cards = screen.getAllByTestId('library-card')
    expect(cards).toHaveLength(2)
    // A text-only advert shows its text instead of a thumbnail.
    expect(within(cards[1]!).getByText('Book your spring oven clean in Twickenham.')).toBeInTheDocument()
    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument()
    expect(callsTo('GET', '/api/posts')[1]?.url).toBe('/api/posts?before=cursor-1')
  })

  it('deletes several adverts at once, and escapes out of the dialog', async () => {
    let left = [advert(), advert({ id: 'a2', topic: 'Autumn ovens' })]
    mockApi({
      ...base,
      'GET /api/posts': () => json({ adverts: left, nextCursor: null }),
      'POST /api/posts/delete': ({ body }) => {
        const ids = (body as { ids: string[] }).ids
        left = left.filter((a) => !ids.includes(a.id))
        return json({ deleted: ids.length })
      },
    })
    renderApp('/library')
    await screen.findAllByTestId('library-card')
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('select-a1'))
    await userEvent.click(screen.getByTestId('select-a2'))
    expect(within(screen.getByTestId('selection-bar')).getByText('2 adverts selected')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('clear-selection'))
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('select-a2'))
    await userEvent.click(screen.getByTestId('delete-selected'))
    expect(await screen.findByText('Delete this advert?')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('select-a1'))
    await userEvent.click(screen.getByTestId('delete-selected'))
    expect(screen.getByText('Delete 2 adverts?')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('confirm-action'))

    await screen.findByText('No adverts yet')
    expect(callsTo('POST', '/api/posts/delete')[0]?.body).toEqual({ ids: ['a2', 'a1'] })
  })

  it('reports a failed bulk delete and keeps the adverts', async () => {
    mockApi({
      ...base,
      'GET /api/posts': () => json({ adverts: [advert()], nextCursor: null }),
      'POST /api/posts/delete': () => json({}, 500),
    })
    renderApp('/library')
    await screen.findByTestId('library-card')
    await userEvent.click(screen.getByTestId('select-a1'))
    await userEvent.click(screen.getByTestId('delete-selected'))
    await userEvent.click(screen.getByTestId('confirm-action'))
    expect(await screen.findByText('They could not be deleted. Try again.')).toBeInTheDocument()
    expect(screen.getByTestId('library-card')).toBeInTheDocument()
  })

  it('opens an advert with copy and downloads', async () => {
    mockApi({
      ...base,
      'GET /api/posts': () => json({ adverts: [advert({ images: [image('facebook')] })], nextCursor: null }),
      'GET /api/posts/a1': () => json({ advert: advert({ images: [image('facebook')] }) }),
    })
    renderApp('/library')
    await userEvent.click(await screen.findByTestId('library-card'))
    const post = await screen.findByTestId('library-post')
    expect(within(post).getByRole('heading', { name: 'Spring ovens' })).toBeInTheDocument()
    expect(within(post).getByRole('button', { name: 'Copy text' })).toBeInTheDocument()
    expect(within(post).getByRole('link', { name: 'Download' })).toHaveAttribute('href', image('facebook').downloadUrl)
    await userEvent.click(screen.getByTestId('back-to-library'))
    await screen.findByTestId('library-card')
  })

  it('deletes an advert after asking once more', async () => {
    let deleted = false
    mockApi({
      ...base,
      'GET /api/posts/a1': () => json({ advert: advert() }),
      'DELETE /api/posts/a1': () => {
        deleted = true
        return json({ ok: true })
      },
      'GET /api/posts': () => json({ adverts: deleted ? [] : [advert()], nextCursor: null }),
    })
    renderApp('/library/a1')
    await userEvent.click(await screen.findByTestId('delete-post'))
    await userEvent.click(screen.getByTestId('cancel-confirm'))
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('delete-post'))
    await userEvent.click(screen.getByTestId('confirm-action'))
    await screen.findByText('No adverts yet')
    expect(callsTo('DELETE', '/api/posts/a1')).toHaveLength(1)
  })

  it('reports a failed delete and a missing or unloadable advert', async () => {
    let fail = true
    mockApi({
      ...base,
      'GET /api/posts/a1': () => (fail ? json({}, 500) : json({ advert: advert() })),
      'DELETE /api/posts/a1': () => json({}, 500),
      'GET /api/posts/gone': () => json({ error: 'Not found' }, 404),
    })
    renderApp('/library/a1')
    await screen.findByText('Could not load this advert.')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await userEvent.click(await screen.findByTestId('delete-post'))
    await userEvent.click(screen.getByTestId('confirm-action'))
    expect(await screen.findByText('The advert could not be deleted. Try again.')).toBeInTheDocument()
  })

  it('says when an advert has already gone', async () => {
    mockApi({ ...base, 'GET /api/posts/gone': () => json({ error: 'Not found' }, 404) })
    renderApp('/library/gone')
    expect(await screen.findByText('This advert is no longer in your library.')).toBeInTheDocument()
  })

  it('shows an empty state that leads to the generator', async () => {
    mockApi({ ...base, 'GET /api/posts': () => json({ adverts: [], nextCursor: null }) })
    renderApp('/library')
    await screen.findByText('No adverts yet')
    await userEvent.click(screen.getByRole('link', { name: 'Create your first advert' }))
    await screen.findByRole('heading', { name: 'Image advert' })
  })

  it('offers a retry when loading fails', async () => {
    let fail = true
    mockApi({
      ...base,
      'GET /api/posts': () => (fail ? json({}, 500) : json({ adverts: [], nextCursor: 'c' })),
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
        json({ websiteUrl: 'https://acme.co.uk/', reachable: true, colours: scanColours, logo: null, logoSvg: null, details: null }),
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

  it('refetches the website on request, points out what changed, and saves only on Save', async () => {
    mockApi({
      ...settingsRoutes(),
      'POST /api/profile/scan': () =>
        json({
          websiteUrl: 'https://acme.co.uk/',
          reachable: true,
          colours: ['#16a34a'],
          logo: null,
          logoSvg: null,
          details: { businessName: 'Acme Cleaning', description: 'We clean ovens.', services: [], targetAudience: null, localArea: null, tone: null },
        }),
    })
    renderApp('/settings')
    await screen.findByTestId('business-name')
    await userEvent.click(screen.getByTestId('fetch-website'))
    await waitFor(() => expect(screen.getByTestId('colour-hex-0')).toHaveValue('#16a34a'))
    expect(screen.getByTestId('description')).toHaveValue('We clean ovens.')
    expect(screen.getByTestId('changed-summary')).toHaveTextContent('Updated from your website: what your business does and colours.')
    expect(screen.getByTestId('changed-brandColours')).toBeInTheDocument()
    expect(screen.queryByTestId('changed-businessName')).not.toBeInTheDocument()
    expect(callsTo('PUT', '/api/profile')).toHaveLength(0)
    const hex = screen.getByTestId('colour-hex-0')
    await userEvent.clear(hex)
    await userEvent.type(hex, 'ff0000')
    await userEvent.click(screen.getByTestId('save-profile'))
    await screen.findByText('Profile saved.')
    expect(callsTo('PUT', '/api/profile')[0]?.body).toMatchObject({ brandColours: ['#ff0000'], description: 'We clean ovens.' })
    expect(screen.queryByTestId('changed-summary')).not.toBeInTheDocument()
  })

  it('says when website checks have been used up', async () => {
    mockApi({ ...settingsRoutes(), 'POST /api/profile/scan': () => json({ code: 'rate_limit' }, 429) })
    renderApp('/settings')
    await userEvent.click(await screen.findByTestId('fetch-website'))
    expect(await screen.findByTestId('scan-notice')).toHaveTextContent('Wait a minute and try again')
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
    expect(await screen.findByText('Choose a PNG, JPEG, WebP, AVIF or SVG image.')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('remove-logo'))
    expect(screen.getByLabelText('No logo')).toBeInTheDocument()
  })

  it('points to email for cancelling or deleting the account', async () => {
    mockApi(settingsRoutes())
    renderApp('/settings')
    const link = await screen.findByRole('link', { name: 'hello@kabooly.com' })
    expect(link).toHaveAttribute('href', 'mailto:hello@kabooly.com')
    expect(screen.queryByRole('button', { name: /delete account/i })).not.toBeInTheDocument()
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
  it('shows no error when the session has just ended, and refreshes it', async () => {
    mockApi({ ...base, 'GET /api/profile': () => json({ error: 'Unauthorised' }, 401) })
    renderApp('/settings')
    await waitFor(() => expect(authMock.refetch).toHaveBeenCalled())
    expect(screen.queryByText(/Could not load your account/)).not.toBeInTheDocument()
  })

  it('offers a retry when the profile cannot load', async () => {
    let fail = true
    mockApi({ ...base, 'GET /api/profile': () => (fail ? json({}, 500) : json({ profile: PROFILE })) })
    renderApp('/')
    await screen.findByText(/Could not load your account/)
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: 'Image advert' })
  })
})
