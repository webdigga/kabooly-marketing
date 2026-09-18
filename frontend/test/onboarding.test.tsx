import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callsTo, json, mockApi, PROFILE, renderApp, signedIn, USAGE } from './helpers'

vi.mock('../src/lib/auth-client', async () => ({ authClient: (await import('./auth-mock')).authMock }))

const LOGO = { key: 'users/u1/logos/scan.png', url: '/api/files/users/u1/logos/scan.png' }

const DETAILS = {
  businessName: 'Acme Cleaning',
  description: 'We clean homes in Twickenham.',
  services: ['Oven cleaning', 'Windows'],
  targetAudience: 'Busy families',
  localArea: 'Twickenham',
  tone: 4,
}

const FOUND = { websiteUrl: 'https://acme.co.uk/', reachable: true, colours: ['#e11d48', '#1d4ed8'], logo: LOGO, logoSvg: null, details: DETAILS }

function routes(scan: () => Response = () => json(FOUND)) {
  return {
    'GET /api/profile': () => json({ profile: null }),
    'POST /api/profile/scan': scan,
    'PUT /api/profile': ({ body }: { body: unknown }) => json({ profile: { ...PROFILE, ...(body as object), logoUrl: null } }),
    'GET /api/usage': () => json(USAGE),
    'POST /api/topics/suggest': () => json({ topic: 'Spring ovens' }),
  }
}

beforeEach(() => {
  signedIn()
  mockApi(routes())
})

async function next() {
  await userEvent.click(screen.getByTestId('next-step'))
}

async function start() {
  renderApp('/onboarding')
  await screen.findByText('Step 1 of 5')
}

async function fillFromWebsite(website = 'acme.co.uk') {
  await userEvent.type(screen.getByTestId('website'), website)
  await next()
  await screen.findByText('Step 2 of 5')
}

async function typeEverythingByHand() {
  await userEvent.type(screen.getByTestId('business-name'), 'Acme Cleaning')
  await userEvent.type(screen.getByTestId('description'), 'Domestic cleaning')
  await next()
  await userEvent.type(screen.getByTestId('audience'), 'Busy families')
  await userEvent.type(screen.getByTestId('local-area'), 'Twickenham')
  await userEvent.click(screen.getByLabelText('Casual'))
  await next()
  await userEvent.type(screen.getByTestId('service-input'), 'Oven cleaning{Enter}')
  await userEvent.type(screen.getByTestId('service-input'), 'Windows')
  await userEvent.click(screen.getByTestId('add-service'))
  await next()
}

describe('onboarding', () => {
  it('runs once for a new account, starting with the website', async () => {
    renderApp('/')
    expect(await screen.findByText('Step 1 of 5')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/onboarding')
    expect(screen.getByTestId('next-step')).toHaveTextContent('Fill in from my website')
  })

  it('asks for a website, or the choice to go without one', async () => {
    await start()
    await next()
    expect(screen.getByText('Enter your website, or choose "I do not have a website".')).toBeInTheDocument()
    await userEvent.type(screen.getByTestId('website'), 'not a website')
    await next()
    expect(screen.getByText('Enter a website address like acme.co.uk.')).toBeInTheDocument()
    expect(callsTo('POST', '/api/profile/scan')).toHaveLength(0)
  })

  it('fills in every step from the website, marks what it filled, and saves the whole profile', async () => {
    await start()
    await fillFromWebsite()
    expect(callsTo('POST', '/api/profile/scan')[0]?.body).toEqual({ url: 'acme.co.uk' })
    expect(screen.getByTestId('scan-notice')).toHaveTextContent('We filled in what we could from your website')
    expect(screen.getByTestId('business-name')).toHaveValue('Acme Cleaning')
    expect(within(screen.getByTestId('changed-description')).getByTestId('description')).toHaveValue('We clean homes in Twickenham.')
    await next()
    expect(screen.getByTestId('audience')).toHaveValue('Busy families')
    expect(screen.getByLabelText('Casual')).toBeChecked()
    await next()
    expect(screen.getByTestId('services-list')).toHaveTextContent('Oven cleaning')
    await next()
    expect(screen.getByTestId('colour-hex-0')).toHaveValue('#e11d48')
    expect(screen.getByAltText('Your logo')).toHaveAttribute('src', LOGO.url)

    await userEvent.click(screen.getByLabelText('Remove colour 2'))
    await next()
    await screen.findByRole('heading', { name: 'Image advert' })
    expect(callsTo('PUT', '/api/profile')[0]?.body).toEqual({
      businessName: 'Acme Cleaning',
      description: 'We clean homes in Twickenham.',
      websiteUrl: 'acme.co.uk',
      targetAudience: 'Busy families',
      localArea: 'Twickenham',
      tone: 4,
      services: ['Oven cleaning', 'Windows'],
      brandColours: ['#e11d48'],
      logoKey: LOGO.key,
      brandStrips: {},
    })
  })

  it('never blocks on a website it cannot read', async () => {
    mockApi(routes(() => json({ websiteUrl: 'https://acme.co.uk/', reachable: false, colours: [], logo: null, logoSvg: null, details: null })))
    await start()
    await fillFromWebsite()
    expect(screen.getByTestId('scan-notice')).toHaveTextContent('We could not read your website')
    await typeEverythingByHand()
    await userEvent.click(screen.getByTestId('add-colour'))
    await next()
    await screen.findByRole('heading', { name: 'Image advert' })
  })

  it('says when a website had nothing to fill in, and treats a failed request as unreadable', async () => {
    mockApi(routes(() => json({ websiteUrl: 'https://acme.co.uk/', reachable: true, colours: [], logo: null, logoSvg: null, details: { ...DETAILS, businessName: null, description: null, services: [], targetAudience: null, localArea: null, tone: null } })))
    await start()
    await fillFromWebsite()
    expect(screen.getByTestId('scan-notice')).toHaveTextContent('We could not find your details')
    expect(screen.getByTestId('business-name')).toHaveValue('')
  })

  it('treats a failed scan request as a website it could not read', async () => {
    mockApi(routes(() => json({ error: 'boom' }, 500)))
    await start()
    await fillFromWebsite()
    expect(screen.getByTestId('scan-notice')).toHaveTextContent('We could not read your website')
  })

  it('goes without a website, and can go back a step', async () => {
    await start()
    await userEvent.type(screen.getByTestId('website'), 'typo')
    await userEvent.click(screen.getByTestId('skip-website'))
    await screen.findByText('Step 2 of 5')
    expect(screen.queryByTestId('scan-notice')).not.toBeInTheDocument()
    await typeEverythingByHand()
    expect(callsTo('POST', '/api/profile/scan')).toHaveLength(0)
    await userEvent.click(screen.getByTestId('back-step'))
    expect(screen.getByText('Step 4 of 5')).toBeInTheDocument()
    expect(screen.getByTestId('services-list')).toHaveTextContent('Oven cleaning')
    await next()
    await next()
    await screen.findByRole('heading', { name: 'Image advert' })
    expect(callsTo('PUT', '/api/profile')[0]?.body).toMatchObject({ websiteUrl: null })
  })

  it('returns to the step the server rejected', async () => {
    mockApi({ ...routes(), 'PUT /api/profile': () => json({ error: 'Invalid request', field: 'websiteUrl' }, 400) })
    await start()
    await fillFromWebsite()
    for (let i = 0; i < 4; i++) await next()
    await waitFor(() => expect(screen.getByText('Step 1 of 5')).toBeInTheDocument())
    expect(screen.getByText('Check this and try again.')).toBeInTheDocument()
  })

  it('can be left by signing out', async () => {
    renderApp('/onboarding')
    await userEvent.click(await screen.findByTestId('onboarding-sign-out'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sign-in'))
  })

  it('will not move on until a step is complete, and refuses a duplicate service', async () => {
    await start()
    await userEvent.click(screen.getByTestId('skip-website'))
    await next()
    expect(screen.getByText('Enter your business name.')).toBeInTheDocument()
    await userEvent.type(screen.getByTestId('business-name'), 'Acme')
    await userEvent.type(screen.getByTestId('description'), 'Cleaning')
    await next()
    await userEvent.type(screen.getByTestId('audience'), 'Families')
    await userEvent.type(screen.getByTestId('local-area'), 'Twickenham')
    await next()
    await userEvent.type(screen.getByTestId('service-input'), 'Windows{Enter}')
    await userEvent.type(screen.getByTestId('service-input'), 'windows{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('windows is already on the list.')
    await userEvent.click(screen.getByLabelText('Remove Windows'))
    await next()
    expect(screen.getByText('Add at least one service or product.')).toBeInTheDocument()
  })
})
