import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ParsingRulesPanel from '../ParsingRulesPanel.vue'
import type { ProfileDraft } from '../user-profile-form'

vi.mock('@/api/strapi', () => ({ default: { get: vi.fn(), put: vi.fn() } }))

const draft: ProfileDraft = {
  regions: ['moscow'],
  property_types: ['office'],
  price_from: null,
  price_to: null,
  area_from: null,
  area_to: null,
  stop_words: ['земля'],
  digest_email: '',
  digest_enabled: false,
}

describe('ParsingRulesPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a comma-delimited recipient list without native single-email validation', async () => {
    const wrapper = mount(ParsingRulesPanel, { props: { modelValue: draft } })

    const email = wrapper.get('[data-testid="profile-digest-email"]')
    expect(email.attributes('type')).toBe('text')
    expect(email.attributes('inputmode')).toBe('email')
    await email.setValue('person@example.test, second@example.test')

    const updates = wrapper.emitted('update:modelValue') || []
    expect(updates[updates.length - 1]?.[0]).toMatchObject({
      ...draft,
      digest_email: 'person@example.test, second@example.test',
    })
  })

  it('emits submit without performing API calls', async () => {
    const wrapper = mount(ParsingRulesPanel, { props: { modelValue: draft } })

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toHaveLength(1)
    const api = (await import('@/api/strapi')).default
    expect(api.get).not.toHaveBeenCalled()
    expect(api.put).not.toHaveBeenCalled()
  })
})
