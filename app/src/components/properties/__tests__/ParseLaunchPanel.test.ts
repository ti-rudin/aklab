import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, reactive, ref } from 'vue'
import ParseLaunchPanel from '../ParseLaunchPanel.vue'
import api from '@/api/strapi'

const start = vi.fn()
const cancel = vi.fn()
const reset = vi.fn()
const checkOnMount = vi.fn()
const state = reactive({
  run_id: null as string | null,
  status: 'idle',
  stage: 'idle',
  message: '',
  sources_total: 0,
  sources_done: 0,
  details_fetched: 0,
  details_needed: 0,
  analyze_total: 0,
  analyze_done: 0,
  undervalued_count: 0,
  objects_created: 0,
  digest_scheduled: 0,
  digest_sent: 0,
  digest_skipped: 0,
  digest_failed: 0,
  errors: [] as string[],
})

vi.mock('@/api/strapi', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/composables/usePipeline', () => ({
  usePipeline: () => ({
    state,
    requestError: ref(''),
    isRunning: computed(() => state.status === 'running' || state.status === 'cancelling'),
    isDone: computed(() => ['done', 'done_with_errors', 'cancelled', 'error'].includes(state.stage)),
    start,
    cancel,
    reset,
    checkOnMount,
  }),
}))

const mockedApi = vi.mocked(api)

const profiles = [
  {
    id: 10,
    user_id: 42,
    regions: ['moscow'],
    property_types: ['office'],
    price_from: null,
    price_to: null,
    area_from: null,
    area_to: null,
    stop_words: [],
    digest_email: null,
    digest_enabled: false,
    profile_version: 1,
  },
]

describe('ParseLaunchPanel admin target contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(state, {
      run_id: null,
      status: 'idle',
      stage: 'idle',
      message: '',
      sources_total: 0,
      sources_done: 0,
      details_fetched: 0,
      details_needed: 0,
      analyze_total: 0,
      analyze_done: 0,
      undervalued_count: 0,
      objects_created: 0,
      digest_scheduled: 0,
      digest_sent: 0,
      digest_skipped: 0,
      digest_failed: 0,
      errors: [],
    })
    mockedApi.get.mockResolvedValue({
      data: { data: profiles, meta: { pagination: { page: 1, pageSize: 100, pageCount: 1, total: 1 } } },
    })
    start.mockResolvedValue('run-1')
  })

  it('loads only the bounded admin profile list and checks status with authenticated Axios', async () => {
    mount(ParseLaunchPanel)
    await flushPromises()

    expect(mockedApi.get).toHaveBeenCalledWith('/admin/user-profiles?page=1&pageSize=100')
    expect(mockedApi.get).not.toHaveBeenCalledWith('/setting')
    expect(checkOnMount).toHaveBeenCalledTimes(1)
  })

  it('requires a target and forwards exact numeric target/depth to the composable', async () => {
    const wrapper = mount(ParseLaunchPanel)
    await flushPromises()

    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(start).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Выберите целевого пользователя')

    await wrapper.find('[data-testid="pipeline-target"]').setValue('42')
    await wrapper.find('[data-testid="pipeline-depth"]').setValue('100')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(start).toHaveBeenCalledWith(42, 100)
    expect(JSON.stringify(start.mock.calls)).not.toContain('filters')
  })

  it('renders only aggregate progress and never target identity from server state', async () => {
    Object.assign(state, {
      run_id: 'run-1',
      status: 'running',
      stage: 'digesting',
      digest_scheduled: 3,
      digest_sent: 1,
      digest_skipped: 1,
      digest_failed: 0,
      sources_total: 2,
      sources_done: 2,
    })
    const wrapper = mount(ParseLaunchPanel)
    await flushPromises()

    expect(wrapper.text()).toContain('Дайджесты')
    expect(wrapper.text()).toContain('1 / 3')
    expect(wrapper.html()).not.toContain('secret@example.test')
  })
})
