// API-Client für den Server (Fastify-Backend).
//
// Siehe PLAN §9a–9b. Im Self-Hosting-Setup liegt nginx im PWA-Container
// und proxied /api/* an die API (gleicher Origin). Daher ist der
// Default ein LEERER String — der Browser ruft dann relative URLs auf
// (/api/auth/login), nginx routet sie an die API.
//
// Auflösung der Basis-URL (höchste Priorität zuerst):
//   1. window.__BMA_API_URL__  — vom Container-Entrypoint aus ENV VITE_API_URL
//                                gesetzt (siehe scripts/pwa-entrypoint.sh).
//                                Leerer String = gleicher Origin.
//   2. localStorage['bma.api.url']  — vom User im Browser überschrieben
//                                    (z. B. für Tests gegen einen anderen Server).
//   3. import.meta.env.VITE_API_URL  — Build-Default (nur bei statischem Build
//                                    ohne Entrypoint-Generierung).
//   4. ''  — gleicher Origin (nginx-Reverse-Proxy-Setup).
//
// Alle Requests senden Authorization: Bearer <jwt> (falls vorhanden) und
// behandeln 401 → Auth-Store wird ausgeloggt.

const LS_API_URL = 'bma.api.url'

/**
 * Normalisiert eine Basis-URL: entfernt genau ein trailing `/api`, falls
 * vorhanden. Häufiger Konfig-Fehler: User setzt
 * `VITE_API_URL=https://example.com/api`, weil dort die API exponiert
 * wird. Unsere App hängt `/api/...` aber selbst an die Basis an, also
 * wäre die finale URL sonst `/api/api/auth/login`. Sub-Pfade wie
 * `/api/v1` werden NICHT angetastet (sie enden nicht exakt auf `/api`).
 */
function normalizeBaseUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '')
  if (trimmed.endsWith('/api')) return trimmed.slice(0, -4)
  return trimmed
}

export function getApiBaseUrl(): string {
  const fromWindow = (globalThis as { __BMA_API_URL__?: string }).__BMA_API_URL__
  if (typeof fromWindow === 'string') return normalizeBaseUrl(fromWindow)
  const stored = localStorage.getItem(LS_API_URL)
  if (stored) return normalizeBaseUrl(stored)
  const fromBuild = import.meta.env.VITE_API_URL
  if (typeof fromBuild === 'string' && fromBuild.length > 0) return normalizeBaseUrl(fromBuild)
  return ''
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
