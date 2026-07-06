import { test, expect } from '@playwright/test'

test('visits the app root url', async ({ page }) => {
  await page.goto('/')
  // Should redirect to /auth or show dashboard
  await expect(page).toHaveURL(/\/(auth|)$/)
})

test('auth page loads', async ({ page }) => {
  await page.goto('/auth')
  // Should have a login form
  await expect(page.locator('input[type="email"], input[type="text"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
})

test('settings page redirects to auth when not logged in', async ({ page }) => {
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/auth/)
})

test('properties page redirects to auth when not logged in', async ({ page }) => {
  await page.goto('/properties')
  await expect(page).toHaveURL(/\/auth/)
})
