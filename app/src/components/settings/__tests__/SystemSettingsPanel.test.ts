import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SystemSettingsPanel from '../SystemSettingsPanel.vue'
import api from '@/api/strapi'

vi.mock('@/api/strapi', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }))

function setup() {
  ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: { data: { threshold_percent: 20, digest_time: '09:00', parse_depth: 20, smtp_to: 'must-not-bind@example.test' } },
  })
  ;(api.put as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: {} } })
  return mount(SystemSettingsPanel)
}

describe('SystemSettingsPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses only GET/PUT setting and the exact three-field system payload', async () => {
    const wrapper = setup()
    await flushPromises()
    expect(api.get).toHaveBeenCalledWith('/setting')

    await wrapper.get('[data-testid="system-threshold"]').setValue('100')
    await wrapper.get('[data-testid="system-parse-depth"]').setValue('5000')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(api.put).toHaveBeenCalledWith('/setting', {
      data: { threshold_percent: 100, digest_time: '09:00', parse_depth: 5000 },
    })
    expect(api.post).not.toHaveBeenCalled()
    expect(JSON.stringify((api.put as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('smtp_to')
    expect(JSON.stringify((api.put as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('digest_enabled')
  })

  it.each([
    ['101', 'threshold_percent'],
    ['0.1.2', 'threshold_percent'],
  ])('rejects invalid %s for %s without a write', async (value) => {
    const wrapper = setup()
    await flushPromises()
    await wrapper.get('[data-testid="system-threshold"]').setValue(value)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('accepts threshold 0 and rejects malformed time/depth bounds', async () => {
    const wrapper = setup()
    await flushPromises()
    await wrapper.get('[data-testid="system-threshold"]').setValue('0')
    await wrapper.get('[data-testid="system-digest-time"]').setValue('9:00')
    await wrapper.get('[data-testid="system-parse-depth"]').setValue('5001')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('fails closed when the setting response has malformed exact fields', async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { data: { threshold_percent: '20', digest_time: '09:00', parse_depth: 20 } },
    })
    const wrapper = mount(SystemSettingsPanel)
    await flushPromises()

    expect(wrapper.text()).toContain('Некорректный ответ системных настроек')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.put).not.toHaveBeenCalled()
  })
})
