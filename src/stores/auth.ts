// Auth-Store: Server-first mit Offline-Fallback.
//
// Login-Flow:
//   1. Versuch gegen POST /api/auth/login
//   2. Bei Erfolg: JWT speichern, PBKDF2-Hash der Credentials für Offline-Fallback speichern
//   3. Bei Netzwerk-Fehler (kein Response): Offline-Fallback versuchen
//   4. Wenn auch das fehlschlägt → User-Fehler "offline und nicht gecached"
//
// Logout: löscht JWT und Session, lässt aber Credential-Cache intakt (für späteres Offline-Login).

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ApiError, apiFetch, setGlobalToken } from '../auth/api'
import {
  credLesen,
  credSchreiben,
  jwtLesen,
  jwtSchreiben,
  offlineLoginMoeglich,
  sessionLesen,
  sessionSchreiben,
  type SessionInfo,
} from '../auth/session'
import { hasheText } from '../auth/crypto'
import {
  aendereEigenesPasswortServer,
  aendereRolleServer,
  deaktiviereUserServer,
  holeAktiveUserliste,
  legeUserAnServer,
  setzeAktivServer,
  setzePasswortServer,
  type LoginAntwort,
  type UserDto,
} from '../auth/users'

export interface LoginOptions {
  /** Wenn true: bei Netzwerk-Fehler den lokalen PBKDF2-Cache verwenden. */
  offlineFallback?: boolean
}

export const useAuthStore = defineStore('auth', () => {
  // ---------- State ----------
  const session = ref<SessionInfo | null>(sessionLesen())
  const istAngemeldet = computed(() => session.value !== null && jwtLesen() !== null)
  const rolle = computed(() => session.value?.rolle ?? null)
  const istAdmin = computed(() => session.value?.rolle === 'admin')
  const userId = computed(() => session.value?.userId ?? null)
  const email = computed(() => session.value?.email ?? null)
  const mussPasswortAendern = computed(() => session.value?.mustChangePassword === true)

  // ---------- Login ----------

  async function anmelden(
    emailInput: string,
    passwort: string,
    opts: LoginOptions = {},
  ): Promise<void> {
    const trimmedEmail = emailInput.trim().toLowerCase()
    if (!trimmedEmail) throw new Error('E-Mail erforderlich')
    if (!passwort) throw new Error('Passwort erforderlich')

    let serverAntwort: LoginAntwort | null = null
    let netzwerkFehler: unknown = null

    try {
      serverAntwort = await apiFetch<LoginAntwort>('/api/auth/login', {
        method: 'POST',
        body: { email: trimmedEmail, password: passwort },
      })
    } catch (e) {
      // Wenn Server sagt "401", ist das ein echter Auth-Fehler — kein Netzwerkproblem.
      // Wir unterscheiden über ApiError vs. TypeError (fetch-Failure).
      if (e instanceof ApiError) {
        throw new Error(e.message)
      }
      netzwerkFehler = e
    }

    if (serverAntwort) {
      jwtSchreiben(serverAntwort.token)
      setGlobalToken(serverAntwort.token)

      // Offline-Cache: PBKDF2-Hash der Credentials speichern
      const hashed = await hasheText(passwort)
      credSchreiben({
        email: trimmedEmail,
        passwordHash: hashed.hash,
        salt: hashed.salt,
        iterations: hashed.iterations,
        cachedAt: new Date().toISOString(),
      })

      // JWT-Expiry aus dem Token dekodieren (Base64-URL, ohne Validierung)
      const jwtExpiresAt =
        parseJwtExpiry(serverAntwort.token)?.toISOString() ?? inHours(12).toISOString()

      const s: SessionInfo = {
        userId: serverAntwort.user.id,
        email: serverAntwort.user.email,
        rolle: serverAntwort.user.rolle,
        loginAm: new Date().toISOString(),
        mustChangePassword: serverAntwort.user.mustChangePassword,
        jwtExpiresAt,
      }
      sessionSchreiben(s)
      session.value = s
      return
    }

    // ---------- Offline-Fallback ----------
    if (!opts.offlineFallback) {
      throw new Error('Server nicht erreichbar. Bitte Internetverbindung prüfen.')
    }
    const ok = await offlineLoginMoeglich(trimmedEmail, passwort)
    if (!ok) {
      throw new Error('Offline-Login nicht möglich: kein gecachter Eintrag oder falsches Passwort.')
    }
    // Wir haben das Passwort verifiziert. JWT ist aber möglicherweise abgelaufen.
    const cached = credLesen(trimmedEmail)
    if (!cached) throw new Error('Interner Fehler: Credential-Cache verloren.')
    const jwt = jwtLesen()
    if (!jwt) {
      throw new Error(
        'Offline-Login möglich, aber kein JWT mehr im Cache. Bitte zuerst online anmelden.',
      )
    }
    const expires = parseJwtExpiry(jwt)
    if (expires && expires.getTime() < Date.now()) {
      throw new Error('JWT abgelaufen. Bitte online anmelden, um neuen Token zu erhalten.')
    }
    // Rekonstruieren der Session aus JWT (wir vertrauen hier dem JWT, weil wir
    // gerade erfolgreich das Passwort verifiziert haben — das ist sicherer als
    // ein abgelaufener Token).
    setGlobalToken(jwt)
    const role = jwtRolle(jwt) ?? 'user'
    const sub = jwtSub(jwt) ?? ''
    const s: SessionInfo = {
      userId: sub,
      email: trimmedEmail,
      rolle: role,
      loginAm: new Date().toISOString(),
      mustChangePassword: false,
      jwtExpiresAt: (expires ?? inHours(12)).toISOString(),
    }
    sessionSchreiben(s)
    session.value = s
    void netzwerkFehler // unterdrückt unused warning
  }

  async function abmelden(): Promise<void> {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // Ignorieren — wir löschen lokal trotzdem.
    }
    jwtSchreiben(null)
    setGlobalToken(null)
    sessionSchreiben(null)
    session.value = null
  }

  // ---------- Passwort-Änderung ----------

  async function aendereEigenesPasswortMit(
    altesPasswort: string,
    neuesPasswort: string,
  ): Promise<void> {
    if (!session.value) throw new Error('nicht angemeldet')
    await aendereEigenesPasswortServer(altesPasswort, neuesPasswort)
    // Lokal: mustChangePassword-Flag entfernen, neue Credentials hashen
    if (session.value) {
      sessionSchreiben({ ...session.value, mustChangePassword: false })
      session.value = { ...session.value, mustChangePassword: false }
    }
    const hashed = await hasheText(neuesPasswort)
    credSchreiben({
      email: session.value?.email ?? '',
      passwordHash: hashed.hash,
      salt: hashed.salt,
      iterations: hashed.iterations,
      cachedAt: new Date().toISOString(),
    })
  }

  // ---------- Admin-Operationen ----------

  async function aktiveUserliste(): Promise<UserDto[]> {
    return holeAktiveUserliste()
  }

  async function neuerUser(input: {
    email: string
    passwort: string
    rolle: 'admin' | 'user'
  }): Promise<void> {
    await legeUserAnServer({
      email: input.email,
      password: input.passwort,
      rolle: input.rolle,
    })
  }

  async function aendereRolle(userId: string, neueRolle: 'admin' | 'user'): Promise<void> {
    await aendereRolleServer(userId, neueRolle)
  }

  async function setzeAktiv(id: string, aktiv: boolean): Promise<void> {
    await setzeAktivServer(id, aktiv)
  }

  async function setzePasswortFuer(userId: string, neuesPasswort: string): Promise<void> {
    await setzePasswortServer(userId, neuesPasswort)
  }

  async function deaktiviereUser(userId: string): Promise<void> {
    await deaktiviereUserServer(userId)
  }

  // ---------- Initialisierung: gespeichertes JWT beim Start setzen ----------

  function init(): void {
    const jwt = jwtLesen()
    if (jwt) setGlobalToken(jwt)
  }

  return {
    session,
    istAngemeldet,
    rolle,
    istAdmin,
    userId,
    email,
    mussPasswortAendern,
    anmelden,
    abmelden,
    aendereEigenesPasswortMit,
    aktiveUserliste,
    neuerUser,
    aendereRolle,
    setzeAktiv,
    setzePasswortFuer,
    deaktiviereUser,
    init,
  }
})

// ---------- JWT-Helfer (kein Verify, nur Payload lesen) ----------

interface JwtPayload {
  sub: string
  email?: string
  rolle?: 'admin' | 'user'
  exp?: number
  iat?: number
}

function decodeBase64Url(s: string): string {
  // base64url → base64
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4)
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
}

export function parseJwt(token: string): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    return JSON.parse(decodeBase64Url(parts[1])) as JwtPayload
  } catch {
    return null
  }
}

export function parseJwtExpiry(token: string): Date | null {
  const p = parseJwt(token)
  if (!p?.exp) return null
  return new Date(p.exp * 1000)
}

function jwtRolle(token: string): 'admin' | 'user' | null {
  return parseJwt(token)?.rolle ?? null
}

function jwtSub(token: string): string | null {
  return parseJwt(token)?.sub ?? null
}

function inHours(h: number): Date {
  return new Date(Date.now() + h * 60 * 60 * 1000)
}
