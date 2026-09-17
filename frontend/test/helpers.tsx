import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { AppRoutes } from '../src/App'
import type { Advert, Profile, Usage } from '../src/lib/types'

export { authMock, session, signedIn, signedOut } from './auth-mock'
export type { FakeUser } from './auth-mock'

// ---- fetch ----

type Handler = (req: { url: string; method: string; body: unknown; raw: RequestInit | undefined }) => Response | Promise<Response>

export const calls: { method: string; url: string; body: unknown }[] = []

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function ndjson(events: unknown[]): Response {
  return new Response(events.map((e) => JSON.stringify(e)).join('\n') + '\n', {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}

// Routes are "METHOD /path" (query string ignored). Unrouted calls fail the
// test loudly with a 599.
export function mockApi(routes: Record<string, Handler>): void {
  calls.length = 0
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = input.split('?')[0]
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body
    calls.push({ method, url: input, body })
    const handler = routes[`${method} ${path}`]
    if (!handler) return new Response(`no mock for ${method} ${input}`, { status: 599 })
    return handler({ url: input, method, body, raw: init })
  })
}

export function callsTo(method: string, path: string) {
  return calls.filter((c) => c.method === method && c.url.split('?')[0] === path)
}

// ---- rendering ----

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

export function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  )
}

// ---- fixtures ----

export const PROFILE: Profile = {
  businessName: 'Acme Cleaning',
  description: 'Domestic cleaning',
  websiteUrl: 'https://acme.co.uk/',
  targetAudience: 'Busy families',
  localArea: 'Twickenham',
  tone: 3,
  services: ['Oven cleaning', 'Windows'],
  brandColours: ['#1d4ed8'],
  logoKey: null,
  logoUrl: null,
}

export const USAGE: Usage = {
  imagesToday: { used: 2, limit: 20, nextFreeAt: null },
  imagesThisMonth: { used: 12, limit: 150, nextFreeAt: null },
  videosThisMonth: { used: 1, limit: 20, nextFreeAt: null },
}

export function advert(overrides: Partial<Advert> = {}): Advert {
  return {
    id: 'a1',
    format: 'images',
    topic: 'Spring ovens',
    body: 'Book your spring oven clean in Twickenham.',
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
    images: [],
    slides: null,
    background: null,
    video: null,
    ...overrides,
  }
}

export function image(platform: 'instagram' | 'facebook' | 'nextdoor', version = 1) {
  const sizes = { instagram: [1080, 1080], facebook: [1200, 630], nextdoor: [1200, 1200] }
  const url = `/api/files/users/u1/posts/a1/${platform}-${version}.jpg`
  return {
    platform,
    label: platform[0]!.toUpperCase() + platform.slice(1),
    width: sizes[platform][0]!,
    height: sizes[platform][1]!,
    url,
    downloadUrl: `${url}?download=kabooly-${platform}-2026-09-15.jpg`,
  }
}
