import { vi } from "vitest";

type Handler = (req: Request) => Response | Promise<Response>;

interface Route {
  prefix: string;
  handler: Handler;
}

export interface Captured {
  url: string;
  method: string;
  body: string;
}

const routes: Route[] = [];
export const captured: Captured[] = [];

// The worker and the tests share one isolate, so stubbing the global fetch
// intercepts the worker's outbound calls (Anthropic, Gemini, and the
// websites the scan reads). Unmocked URLs fail loudly with a 599.
export function installFetchMock(): void {
  routes.length = 0;
  captured.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    captured.push({ url: req.url, method: req.method, body: await req.clone().text() });
    // Latest registration wins, so a test can override a default route.
    const route = [...routes].reverse().find((r) => req.url.startsWith(r.prefix));
    if (!route) return new Response(`no mock for ${req.url}`, { status: 599 });
    return route.handler(req);
  });
}

export function onFetch(prefix: string, handler: Handler): void {
  routes.push({ prefix, handler });
}

export function callsTo(prefix: string): Captured[] {
  return captured.filter((c) => c.url.startsWith(prefix));
}
