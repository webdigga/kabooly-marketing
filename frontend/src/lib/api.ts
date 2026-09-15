export interface ApiErrorBody {
  error?: string
  code?: string
  field?: string
  message?: string
  retryAt?: string
  nextFreeAt?: string
  remaining?: number
  limit?: number
}

export class ApiError extends Error {
  readonly status: number
  readonly body: ApiErrorBody

  constructor(status: number, body: ApiErrorBody) {
    super(body.error ?? body.message ?? `Request failed (${status})`)
    this.status = status
    this.body = body
  }

  get code(): string | undefined {
    return this.body.code
  }
}

interface Options {
  method?: string
  body?: unknown
  // Raw bytes (a logo upload) instead of JSON.
  blob?: Blob
}

async function errorBody(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.json()) as ApiErrorBody
  } catch {
    return {}
  }
}

// Sends a request and returns the Response, throwing ApiError for any
// non-2xx status. Used directly for the streaming generation endpoint.
export async function request(path: string, options: Options = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  let body: BodyInit | undefined
  if (options.blob) {
    body = options.blob
    headers['Content-Type'] = options.blob.type || 'application/octet-stream'
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body)
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(path, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    credentials: 'same-origin',
  })
  if (!res.ok) throw new ApiError(res.status, await errorBody(res))
  return res
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const res = await request(path, options)
  return (await res.json()) as T
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status < 500 && err.body.error && err.body.error !== 'Invalid request') {
    return err.body.error
  }
  return fallback
}
