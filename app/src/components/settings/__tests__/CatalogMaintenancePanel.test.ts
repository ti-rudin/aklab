import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import CatalogMaintenancePanel from '../CatalogMaintenancePanel.vue'
import api from '@/api/strapi'

vi.mock('@/api/strapi', () => ({
  default: { post: vi.fn() },
}))

const CONFIRMATION = 'CLEAR_ALL_PROPERTIES'

describe('CatalogMaintenancePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the destructive action disabled until the exact confirmation is entered', async () => {
    const wrapper = mount(CatalogMaintenancePanel)
    const button = wrapper.get('[data-testid="catalog-cleanup-submit"]')

    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="catalog-cleanup-confirmation"]').setValue('clear')
    expect(button.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="catalog-cleanup-confirmation"]').setValue(CONFIRMATION)
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('posts only the exact confirmation and renders aggregate audit counts without starting reparse', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        data: {
          deleted: {
            user_property_states: 3,
            user_comments: 4,
            property_events: 5,
            properties: 2,
          },
          protected_before: { users: 1, user_profiles: 1, settings: 1, sources: 10 },
          protected_after: { users: 1, user_profiles: 1, settings: 1, sources: 10 },
          photos: { attempted: 2, deleted: 2, failed: 0 },
        },
      },
    })
    const wrapper = mount(CatalogMaintenancePanel)
    await wrapper.get('[data-testid="catalog-cleanup-confirmation"]').setValue(CONFIRMATION)

    await wrapper.get('[data-testid="catalog-cleanup-submit"]').trigger('click')
    await flushPromises()

    expect(api.post).toHaveBeenCalledWith('/properties/clear-new', { confirmation: CONFIRMATION })
    expect(api.post).not.toHaveBeenCalledWith(expect.stringContaining('/pipeline/start'), expect.anything())
    expect(wrapper.text()).toContain('Удалено объектов: 2')
    expect(wrapper.text()).toContain('Фото-каталогов удалено: 2 из 2')
    expect(wrapper.text()).toContain('Полный повторный парсинг запускается отдельно')
  })

  it('renders a safe busy message for 409 and never exposes raw response details', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { status: 409, data: { error: 'raw internal detail' } },
    })
    const wrapper = mount(CatalogMaintenancePanel)
    await wrapper.get('[data-testid="catalog-cleanup-confirmation"]').setValue(CONFIRMATION)

    await wrapper.get('[data-testid="catalog-cleanup-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Очистка недоступна: остановите pipeline и дождитесь пустых очередей')
    expect(wrapper.text()).not.toContain('raw internal detail')
  })
})
