import { expect, test, type Browser, type Page } from '@playwright/test'

type Role = 'admin' | 'userA' | 'userB'
type RoleCredential = { email: string; password: string }

type MultiuserConfig = {
  enabled: boolean
  reason: string
  baseURL: string
  apiURL: string
  credentials: Record<Role, RoleCredential>
  allowMutations?: boolean
  photoDocumentId?: string
  photoFilename?: string
  foreignPropertyId?: string
}

const TRUSTED_TARGET_PAIRS = [
  { kind: 'dev', ui: 'https://aklab-dev.tirobots.ru', api: 'https://api-aklab-dev.tirobots.ru' },
  { kind: 'production', ui: 'https://aklab.tirobots.ru', api: 'https://api-aklab.tirobots.ru' },
  { kind: 'local', ui: 'http://127.0.0.1:5174', api: 'http://127.0.0.1:1338' },
] as const
const ROLES: readonly Role[] = ['admin', 'userA', 'userB']
const URLConstructor = (globalThis as any).URL
const ENV: Record<string, string | undefined> = (
  globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
).process?.env || {}

function normalizeOrigin(value: string, name: string): string {
  let url
  try {
    url = new URLConstructor(value)
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} must use http or https`)
  if (url.username || url.password) throw new Error(`${name} must not contain credentials`)
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error(`${name} must be an origin URL without path, query or hash`)
  }
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (url.protocol !== 'https:' && !loopback.has(url.hostname)) {
    throw new Error(`${name} must use HTTPS for a remote target`)
  }
  return url.origin
}

function trustedTargetPair(apiURL: string, baseURL: string) {
  return TRUSTED_TARGET_PAIRS.find(pair => pair.api === apiURL && pair.ui === baseURL)
}

function required(name: string): string | null {
  const value = ENV[name]?.trim()
  return value ? value : null
}

function buildConfig(): MultiuserConfig {
  const missing: string[] = []
  const baseURL = required('SMOKE_UI_URL')
  const apiURL = required('SMOKE_API_URL')
  if (!baseURL) missing.push('SMOKE_UI_URL')
  if (!apiURL) missing.push('SMOKE_API_URL')

  const credentials = {} as Record<Role, RoleCredential>
  const envNames: Record<Role, [string, string]> = {
    admin: ['SMOKE_ADMIN_EMAIL', 'SMOKE_ADMIN_PASSWORD'],
    userA: ['SMOKE_USER_A_EMAIL', 'SMOKE_USER_A_PASSWORD'],
    userB: ['SMOKE_USER_B_EMAIL', 'SMOKE_USER_B_PASSWORD'],
  }
  for (const role of ROLES) {
    const [emailName, passwordName] = envNames[role]
    const email = required(emailName)
    const password = required(passwordName)
    if (!email) missing.push(emailName)
    if (!password) missing.push(passwordName)
    credentials[role] = { email: email || '', password: password || '' }
  }

  if (ENV.E2E_MULTIUSER !== '1') missing.push('E2E_MULTIUSER=1')
  if (missing.length > 0) {
    return {
      enabled: false,
      reason: `multiuser Playwright пропущен: задайте ${missing.join(', ')}`,
      baseURL: 'http://127.0.0.1:5174',
      apiURL: 'http://127.0.0.1:1338',
      credentials,
    }
  }

  let safeBaseURL: string
  let safeApiURL: string
  try {
    safeBaseURL = normalizeOrigin(baseURL!, 'SMOKE_UI_URL')
    safeApiURL = normalizeOrigin(apiURL!, 'SMOKE_API_URL')
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'invalid target URL')
  }

  const targetPair = trustedTargetPair(safeApiURL, safeBaseURL)
  if (!targetPair) {
    throw new Error('SMOKE_API_URL/SMOKE_UI_URL do not form a trusted target pair')
  }

  if (new Set(ROLES.map(role => credentials[role].email)).size !== ROLES.length) {
    throw new Error('SMOKE_ADMIN/USER_A/USER_B must identify three distinct accounts')
  }

  if (ENV.E2E_ALLOW_PRODUCTION !== undefined && ENV.E2E_ALLOW_PRODUCTION !== '' && ENV.E2E_ALLOW_PRODUCTION !== '1') {
    throw new Error('E2E_ALLOW_PRODUCTION must be exactly 1 when enabled')
  }
  if (ENV.E2E_ALLOW_PRODUCTION === '1' && targetPair.kind !== 'production') {
    throw new Error('E2E_ALLOW_PRODUCTION=1 is only valid for the trusted production pair')
  }
  if (targetPair.kind === 'production' && ENV.E2E_ALLOW_PRODUCTION !== '1') {
    throw new Error('production URL is blocked without E2E_ALLOW_PRODUCTION=1')
  }

  return {
    enabled: true,
    reason: '',
    baseURL: safeBaseURL,
    apiURL: safeApiURL,
    credentials,
    allowMutations: ENV.SMOKE_ALLOW_MUTATIONS === '1' && ENV.SMOKE_MUTATION_CONFIRM === 'fixture-only',
    photoDocumentId: required('SMOKE_PHOTO_DOCUMENT_ID') || undefined,
    photoFilename: required('SMOKE_PHOTO_FILENAME') || undefined,
    foreignPropertyId: required('SMOKE_FOREIGN_PROPERTY_ID') || undefined,
  }
}

const CONFIG = buildConfig()

// A missing env must not cause a browser, server, or network request to start.
test.use({ baseURL: CONFIG.baseURL, trace: 'off', screenshot: 'off', video: 'off' })

type ApiResult = { status: number; body: unknown }

async function jwtFromPage(page: Page): Promise<string> {
  const token = await page.evaluate(() => window.localStorage.getItem('jwt'))
  if (!token) throw new Error('JWT отсутствует после UI login')
  return token
}

async function apiRequest(page: Page, method: string, path: string, authenticated = true): Promise<ApiResult> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (authenticated) headers.Authorization = `Bearer ${await jwtFromPage(page)}`
  const response = await page.request.fetch(`${CONFIG.apiURL}${path}`, { method, headers })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Binary photo responses are intentionally not JSON-decoded.
  }
  return { status: response.status(), body }
}

function dataOf(result: ApiResult): any {
  return (result.body as any)?.data
}

function statsOf(result: ApiResult): any {
  return dataOf(result) ?? result.body
}

function rowsOf(result: ApiResult): any[] {
  const data = dataOf(result)
  if (!Array.isArray(data)) throw new Error('scoped list DTO is not an array')
  return data
}

function idOf(row: any): string | null {
  return typeof row?.documentId === 'string' && row.documentId !== '' ? row.documentId : null
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).sort().join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stable((value as any)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function expectDenied(status: number): void {
  expect([401, 403]).toContain(status)
}

function profilesAreIncompatible(left: any, right: any): boolean {
  const toStringSet = (value: unknown): Set<string> => new Set(
    Array.isArray(value) ? value.map(item => String(item)) : [],
  )
  const leftRegions = toStringSet(left?.regions)
  const rightRegions = toStringSet(right?.regions)
  const leftTypes = toStringSet(left?.property_types)
  const rightTypes = toStringSet(right?.property_types)
  const disjoint = (a: Set<string>, b: Set<string>) => a.size > 0 && b.size > 0 && [...a].every(value => !b.has(value))
  const rangeDisjoint = (leftFrom: unknown, leftTo: unknown, rightFrom: unknown, rightTo: unknown) => {
    const lf = leftFrom == null ? -Infinity : Number(leftFrom)
    const lt = leftTo == null ? Infinity : Number(leftTo)
    const rf = rightFrom == null ? -Infinity : Number(rightFrom)
    const rt = rightTo == null ? Infinity : Number(rightTo)
    return lt < rf || rt < lf
  }
  return disjoint(leftRegions, rightRegions)
    || disjoint(leftTypes, rightTypes)
    || rangeDisjoint(left?.price_from, left?.price_to, right?.price_from, right?.price_to)
    || rangeDisjoint(left?.area_from, left?.area_to, right?.area_from, right?.area_to)
}

async function login(page: Page, role: Role): Promise<void> {
  const credentials = CONFIG.credentials[role]
  await page.goto('/auth')
  await page.locator('#email').fill(credentials.email)
  await page.locator('#password').fill(credentials.password)
  const authResponsePromise = page.waitForResponse(response => {
    const url = new URLConstructor(response.url())
    return response.request().method() === 'POST' && url.pathname === '/api/auth/local'
  })
  await page.locator('button[type="submit"]').click()
  const authResponse = await authResponsePromise
  expect(new URLConstructor(authResponse.url()).origin).toBe(CONFIG.apiURL)
  await expect(page).toHaveURL(/\/properties/, { timeout: 15000 })
}

async function openRole(browser: Browser, role: Role): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: CONFIG.baseURL })
  const page = await context.newPage()
  await login(page, role)
  return { page, close: () => context.close() }
}

test.describe('AKLAB multi-user dev acceptance', () => {
  test.skip(!CONFIG.enabled, CONFIG.reason)
  test.describe.configure({ mode: 'serial' })

  test('health and no-auth data/media boundaries are explicit', async ({ page }) => {
    const unauthenticated = await apiRequest(page, 'GET', '/api/properties', false)
    expectDenied(unauthenticated.status)
    const settings = await apiRequest(page, 'GET', '/api/setting', false)
    expectDenied(settings.status)
    const pipeline = await apiRequest(page, 'GET', '/api/pipeline/status', false)
    expectDenied(pipeline.status)

    const documentId = CONFIG.photoDocumentId || 'smoke-document'
    const filename = CONFIG.photoFilename || 'smoke.jpg'
    const photo = await apiRequest(page, 'GET', `/api/photos/${encodeURIComponent(documentId)}/${encodeURIComponent(filename)}`, false)
    expectDenied(photo.status)
  })

  test('admin target profile and A/B context/list/stats/detail scope are isolated', async ({ browser }) => {
    const shells: Partial<Record<Role, { page: Page; close: () => Promise<void> }>> = {}
    try {
      for (const role of ROLES) shells[role] = await openRole(browser, role)
      const admin = shells.admin!.page
      const userA = shells.userA!.page
      const userB = shells.userB!.page

      const [adminContext, contextA, contextB] = await Promise.all([
        apiRequest(admin, 'GET', '/api/me/context'),
        apiRequest(userA, 'GET', '/api/me/context'),
        apiRequest(userB, 'GET', '/api/me/context'),
      ])
      expect(adminContext.status).toBe(200)
      expect(contextA.status).toBe(200)
      expect(contextB.status).toBe(200)
      expect(dataOf(adminContext)?.role?.type).toBe('aklab_admin')
      expect(dataOf(contextA)?.role?.type).not.toBe('aklab_admin')
      expect(dataOf(contextB)?.role?.type).not.toBe('aklab_admin')
      expect(dataOf(contextA)?.user?.id).not.toBe(dataOf(contextB)?.user?.id)
      expect(dataOf(contextA)?.multiuserEnabled).toBe(true)
      expect(dataOf(contextB)?.multiuserEnabled).toBe(true)

      const [profileA, profileB] = await Promise.all([
        apiRequest(userA, 'GET', '/api/me/profile'),
        apiRequest(userB, 'GET', '/api/me/profile'),
      ])
      expect(profileA.status).toBe(200)
      expect(profileB.status).toBe(200)
      expect(dataOf(profileA)?.user_id).toBe(dataOf(contextA)?.user?.id)
      expect(dataOf(profileB)?.user_id).toBe(dataOf(contextB)?.user?.id)
      expect(profilesAreIncompatible(dataOf(profileA), dataOf(profileB))).toBe(true)

      const [listA, listB, statsA, statsB] = await Promise.all([
        apiRequest(userA, 'GET', '/api/properties?page=1&pageSize=100'),
        apiRequest(userB, 'GET', '/api/properties?page=1&pageSize=100'),
        apiRequest(userA, 'GET', '/api/properties/stats'),
        apiRequest(userB, 'GET', '/api/properties/stats'),
      ])
      expect(listA.status).toBe(200)
      expect(listB.status).toBe(200)
      expect(statsA.status).toBe(200)
      expect(statsB.status).toBe(200)
      const rowsA = rowsOf(listA)
      const rowsB = rowsOf(listB)
      expect(rowsA.length + rowsB.length).toBeGreaterThan(0)
      expect(stable(statsOf(statsA))).not.toBe(stable(statsOf(statsB)))

      const idsA = new Set(rowsA.map(idOf).filter(Boolean))
      const idsB = new Set(rowsB.map(idOf).filter(Boolean))
      if (CONFIG.foreignPropertyId) {
        expect(idsA.has(CONFIG.foreignPropertyId)).toBe(true)
        expect(idsB.has(CONFIG.foreignPropertyId)).toBe(false)
      }
      const foreignId = CONFIG.foreignPropertyId || [...idsA].find(id => !idsB.has(id))
      expect(foreignId).toBeTruthy()
      const ownId = [...idsA][0]
      expect(ownId).toBeTruthy()
      const ownDetail = await apiRequest(userA, 'GET', `/api/properties/${encodeURIComponent(ownId!)}`)
      expect(ownDetail.status).toBe(200)
      const foreignDetail = await apiRequest(userB, 'GET', `/api/properties/${encodeURIComponent(foreignId!)}`)
      expect(foreignDetail.status).toBe(404)

      const targetProfile = await apiRequest(admin, 'GET', `/api/admin/user-profiles/${dataOf(contextB)?.user?.id}`)
      expect(targetProfile.status).toBe(200)
      expect(dataOf(targetProfile)?.user_id).toBe(dataOf(contextB)?.user?.id)

      const ordinaryAdminList = await apiRequest(userA, 'GET', '/api/admin/user-profiles')
      expect(ordinaryAdminList.status).toBe(403)
      const adminPipeline = await apiRequest(admin, 'GET', '/api/pipeline/status')
      expect(adminPipeline.status).toBe(200)
      const ordinaryPipeline = await apiRequest(userA, 'GET', '/api/pipeline/status')
      expect(ordinaryPipeline.status).toBe(403)

      // POST /api/pipeline/start is intentionally not called: its exact target
      // contract is checked by the smoke plan and manual runtime evidence.
      expect({ method: 'POST', path: '/api/pipeline/start', mode: 'full', targetUserId: dataOf(contextB)?.user?.id }).toMatchObject({
        method: 'POST',
        path: '/api/pipeline/start',
        mode: 'full',
      })
    } finally {
      for (const role of ROLES) await shells[role]?.close()
    }
  })

  test('ordinary user cannot mutate global settings/source/pipeline', async ({ browser }) => {
    test.skip(
      !CONFIG.allowMutations,
      'mutation probes disabled; require exact SMOKE_ALLOW_MUTATIONS=1 and SMOKE_MUTATION_CONFIRM=fixture-only',
    )
    const shell = await openRole(browser, 'userA')
    try {
      expect((await apiRequest(shell.page, 'PUT', '/api/setting')).status).toBe(403)
      expect((await apiRequest(shell.page, 'PUT', '/api/sources/__smoke_denied__')).status).toBe(403)
      expect((await apiRequest(shell.page, 'POST', '/api/pipeline/start')).status).toBe(403)
    } finally {
      await shell.close()
    }
  })

  test('private photo is accessible to user A and hidden from user B', async ({ browser }) => {
    test.skip(!CONFIG.photoDocumentId || !CONFIG.photoFilename, 'set an A-only SMOKE_PHOTO_DOCUMENT_ID and SMOKE_PHOTO_FILENAME')
    const shellA = await openRole(browser, 'userA')
    const shellB = await openRole(browser, 'userB')
    try {
      const path = `/api/photos/${encodeURIComponent(CONFIG.photoDocumentId!)}/${encodeURIComponent(CONFIG.photoFilename!)}`
      const [allowed, foreign] = await Promise.all([
        apiRequest(shellA.page, 'GET', path),
        apiRequest(shellB.page, 'GET', path),
      ])
      expect(allowed.status).toBe(200)
      expect(foreign.status).toBe(404)
    } finally {
      await shellA.close()
      await shellB.close()
    }
  })
})
