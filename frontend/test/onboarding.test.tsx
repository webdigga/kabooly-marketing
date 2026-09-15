import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callsTo, json, mockApi, PROFILE, renderApp, signedIn, USAGE } from './helpers'

vi.mock('../src/lib/auth-client', async () => ({ authClient: (await import('./auth-mock')).authMock }))

const LOGO = { key: 'users/u1/logos/scan.png', url: '/api/files/users/u1/logos/scan.png' }

function routes(scan: () => Response = () => json({ websiteUrl: 'https://acme.co.uk/', reachable: true, colours: ['#e11d48', '#1d4ed8'], logo: LOGO, logoSvg: null })) {
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

async function completeFirstThreeSteps(website = 'acme.co.uk') {
  await userEvent.type(screen.getByTestId('business-name'), 'Acme Cleaning')
  await userEvent.type(screen.getByTestId('description'), 'Domestic cleaning')
  if (website) await userEvent.type(screen.getByTestId('website'), website)
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
  it('runs once for a new account, straight after verification', async () => {
    renderApp('/')
    expect(await screen.findByText('Step 1 of 4')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/onboarding')
  })

  it('will not move on until the step is complete', async () => {
    renderApp('/onboarding')
    await screen.findByText('Step 1 of 4')
    await userEvent.type(screen.getByTestId('website'), 'not a website')
    await next()
    expect(screen.getByText('Enter your business name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a website address like acme.co.uk.')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
  })

  it('pre-fills colours and logo from the website, then saves the whole profile', async () => {
    renderApp('/onboarding')
    await screen.findByText('Step 1 of 4')
    await completeFirstThreeSteps()

    expect(await screen.findByTestId('scan-notice')).toHaveTextContent('We filled these in from your website')
    expect(screen.getByTestId('colour-hex-0')).toHaveValue('#e11d48')
    expect(screen.getByAltText('Your logo')).toHaveAttribute('src', LOGO.url)
    expect(callsTo('POST', '/api/profile/scan')[0]?.body).toEqual({ url: 'acme.co.uk' })

    await userEvent.click(screen.getByLabelText('Remove colour 2'))
    await next()
    await screen.findByRole('heading', { name: 'Create an advert' })
    expect(callsTo('PUT', '/api/profile')[0]?.body).toEqual({
      businessName: 'Acme Cleaning',
      description: 'Domestic cleaning',
      websiteUrl: 'acme.co.uk',
      targetAudience: 'Busy families',
      localArea: 'Twickenham',
      tone: 4,
      services: ['Oven cleaning', 'Windows'],
      brandColours: ['#e11d48'],
      logoKey: LOGO.key,
    })
  })

  it('never blocks on a website it cannot read', async () => {
    mockApi(routes(() => json({ websiteUrl: 'https://acme.co.uk/', reachable: false, colours: [], logo: null, logoSvg: null })))
    renderApp('/onboarding')
    await screen.findByText('Step 1 of 4')
    await completeFirstThreeSteps()
    expect(await screen.findByTestId('scan-notice')).toHaveTextContent('We could not read your website')
    await userEvent.click(screen.getByTestId('add-colour'))
    await next()
    await screen.findByRole('heading', { name: 'Create an advert' })
  })

  it('treats a failed scan request the same way', async () => {
    mockApi(routes(() => json({ error: 'boom' }, 500)))
    renderApp('/onboarding')
    await screen.findByText('Step 1 of 4')
    await completeFirstThreeSteps()
    expect(await screen.findByTestId('scan-notice')).toHaveTextContent('We could not read your website')
  })

  it('skips the scan when there is no website, and can go back a step', async () => {
    renderApp('/onboarding')
    await screen.findByText('Step 1 of 4')
    await completeFirstThreeSteps('')
    expect(screen.queryByTestId('scan-notice')).not.toBeInTheDocument()
    expect(callsTo('POST', '/api/profile/scan')).toHaveLength(0)
    await userEvent.click(screen.getByTestId('back-step'))
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()
    expect(screen.getByTestId('services-list')).toHaveTextContent('Oven cleaning')
  })

  it('returns to the step the server rejected', async () => {
    mockApi({ ...routes(), 'PUT /api/profile': () => json({ error: 'Invalid request', field: 'websiteUrl' }, 400) })
    renderApp('/onboarding')
    await screen.findByText('Step 1 of 4')
    await completeFirstThreeSteps()
    await next()
    await waitFor(() => expect(screen.getByText('Step 1 of 4')).toBeInTheDocument())
    expect(screen.getByText('Check this and try again.')).toBeInTheDocument()
  })

  it('can be left by signing out', async () => {
    renderApp('/onboarding')
    await userEvent.click(await screen.findByTestId('onboarding-sign-out'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sign-in'))
  })

  it('refuses a duplicate service', async () => {
    renderApp('/onboarding')
    await screen.findByText('Step 1 of 4')
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
