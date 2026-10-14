// API-Client für den Server (Fastify-Backend).
//
// Siehe PLAN §9a–9b. Default zeigt auf den Production-Port aus
// docker-compose.yml (4242). Im Dev-Modus (npm run dev) läuft der
// Fastify-Server auf 3000; das wird über localStorage überschrieben
// oder in Settings eingestellt.
//
// Konfiguration via `localStorage.bma.api.url` (kann der Admin in
// Einstellungen setzen).
//
// Alle Requests senden Authorization: Bearer <jwt> (falls vorhanden) und
// behandeln 401 → Auth-Store wird ausgeloggt.

const LS_API_URL = 'bma.api.url'

export function getApiBaseUrl(): string {
  const stored = localStorage.getItem(LS_API_URL)
  return stored ?? 'http://localhost:4242'
}

export function setApiBaseUrl(url: string): void {
  localStorage.setItem(LS_API_URL, url)
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Token, falls nicht aus dem Auth-Store geholt werden soll (für zirkuläre Imports). */
  token?: string | null
  /** Wenn true, wird bei 401 KEIN Logout getriggert. */
  noLogoutOn401?: boolean
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Setzt ein Token, das automatisch an alle Requests angehängt wird. */
let _globalToken: string | null = null

export function setGlobalToken(token: string | null): void {
  _globalToken = token
}

export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  const token = opts.token ?? _globalToken
  if (token) headers['Authorization'] = `Bearer ${token}`

  let body: BodyInit | undefined
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData) {
      body = opts.body
    } else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
  }

  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body,
    credentials: 'include', // Refresh-Cookie
  })

  if (res.status === 204) return undefined as T

  let payload: unknown = null
  const ct = res.headers.get('Content-Type') ?? ''
  if (ct.includes('application/json')) {
    payload = await res.json().catch(() => null)
  }

  if (!res.ok) {
    const code = (payload as { code?: string } | null)?.code ?? `HTTP_${res.status}`
    const message =
      (payload as { message?: string } | null)?.message ?? res.statusText ?? 'Server-Fehler'
    throw new ApiError(res.status, code, message, payload as Record<string, unknown> | undefined)
  }

  return payload as T
}
