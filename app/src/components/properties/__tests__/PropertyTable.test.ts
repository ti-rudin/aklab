import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PropertyTable from '../PropertyTable.vue'
import type { Property } from '@/composables/usePropertyData'

const items: Property[] = [
  {
    id: 1,
    documentId: 'doc1',
    title: 'Объект A',
    address: 'ул. Ленина, 1',
    city: 'moscow',
    property_type: 'office',
    area_sqm: '100',
    price: '5000000',
    price_per_sqm: '50000',
    status: 'new',
    source: 'CIAN',
    focus_score: 80,
    deviation_percent: '-25',
    tags: ['new', 'undervalued'],
    has_minimum_price: false,
  },
  {
    id: 2,
    documentId: 'doc2',
    title: 'Объект B',
    address: 'пр. Мира, 5',
    city: 'mo',
    property_type: 'warehouse',
    area_sqm: '200',
    price: '8000000',
    price_per_sqm: '40000',
    status: 'viewed',
    source: 'Avito',
    focus_score: 60,
    deviation_percent: null,
    tags: [],
    has_minimum_price: true,
  },
]

describe('PropertyTable', () => {
  it('renders a row for each item', () => {
    const wrapper = mount(PropertyTable, { props: { items } })
    expect(wrapper.text()).toContain('Объект A')
    expect(wrapper.text()).toContain('Объект B')
  })

  it('default variant shows source and status columns', () => {
    const wrapper = mount(PropertyTable, { props: { items, variant: 'default' } })
    expect(wrapper.text()).toContain('Источник')
    expect(wrapper.text()).toContain('Статус')
    // does NOT show focus-specific columns
    expect(wrapper.text()).not.toContain('Скор')
  })

  it('focus variant shows checkbox, Скор, deviation, and tags columns', () => {
    const wrapper = mount(PropertyTable, { props: { items, variant: 'focus' } })
    expect(wrapper.find('thead input[type="checkbox"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Скор')
    expect(wrapper.text()).toContain('Отклонение')
    expect(wrapper.text()).toContain('Теги')
  })

  it('default variant has no checkboxes', () => {
    const wrapper = mount(PropertyTable, { props: { items, variant: 'default' } })
    expect(wrapper.find('thead input[type="checkbox"]').exists()).toBe(false)
  })

  it('shows sort indicator (▲) for asc sort on matching field', () => {
    const wrapper = mount(PropertyTable, {
      props: { items, sortField: 'price', sortDirection: 'asc' },
    })
    // The price th should contain ▲
    const ths = wrapper.findAll('th')
    const priceTh = ths.find(th => th.text().includes('Цена'))
    expect(priceTh).toBeTruthy()
    expect(priceTh!.text()).toContain('▲')
  })

  it('shows sort indicator (▼) for desc sort on matching field', () => {
    const wrapper = mount(PropertyTable, {
      props: { items, sortField: 'price', sortDirection: 'desc' },
    })
    const ths = wrapper.findAll('th')
    const priceTh = ths.find(th => th.text().includes('Цена'))
    expect(priceTh).toBeTruthy()
    expect(priceTh!.text()).toContain('▼')
  })

  it('does not show sort indicator for non-matching field', () => {
    const wrapper = mount(PropertyTable, {
      props: { items, sortField: 'price', sortDirection: 'desc' },
    })
    const ths = wrapper.findAll('th')
    const areaTh = ths.find(th => th.text().includes('Площадь'))
    expect(areaTh).toBeTruthy()
    expect(areaTh!.text()).not.toContain('▲')
    expect(areaTh!.text()).not.toContain('▼')
  })

  it('emits sort when clicking sortable th (title)', async () => {
    const wrapper = mount(PropertyTable, { props: { items } })
    const titleTh = wrapper.find('th[colspan="20"]')
    await titleTh.trigger('click')
    expect(wrapper.emitted('sort')![0]).toEqual(['title'])
  })

  it('emits sort with correct field for price th', async () => {
    const wrapper = mount(PropertyTable, { props: { items } })
    const ths = wrapper.findAll('th')
    const priceTh = ths.find(th => th.text().includes('Цена'))
    await priceTh!.trigger('click')
    expect(wrapper.emitted('sort')![0]).toEqual(['price'])
  })

  it('emits open when clicking a row', async () => {
    const wrapper = mount(PropertyTable, { props: { items } })
    const trs = wrapper.findAll('tbody tr')
    await trs[0].trigger('click')
    expect(wrapper.emitted('open')![0]).toEqual([items[0]])
  })

  it('emits toggle-select with item id on checkbox change', async () => {
    const wrapper = mount(PropertyTable, { props: { items, variant: 'focus' } })
    // Find the checkbox in the tbody (not the header one)
    const bodyCheckboxes = wrapper.findAll('tbody input[type="checkbox"]')
    expect(bodyCheckboxes.length).toBeGreaterThan(0)
    await bodyCheckboxes[0].trigger('change')
    expect(wrapper.emitted('toggle-select')![0]).toEqual([1])
  })

  it('emits toggle-all when header checkbox changes', async () => {
    const wrapper = mount(PropertyTable, { props: { items, variant: 'focus' } })
    const headerCheckbox = wrapper.find('thead input[type="checkbox"]')
    await headerCheckbox.trigger('change')
    expect(wrapper.emitted('toggle-all')).toBeTruthy()
  })

  it('checks body checkboxes for selected items', () => {
    const selectedIds = new Set([1])
    const wrapper = mount(PropertyTable, {
      props: { items, variant: 'focus', selectedIds },
    })
    const bodyCheckboxes = wrapper.findAll('tbody input[type="checkbox"]')
    // item 1 (id=1) should be checked, item 2 (id=2) should not
    expect((bodyCheckboxes[0].element as HTMLInputElement).checked).toBe(true)
    expect((bodyCheckboxes[1].element as HTMLInputElement).checked).toBe(false)
  })

  it('header checkbox is checked when allSelected is true', () => {
    const wrapper = mount(PropertyTable, {
      props: { items, variant: 'focus', allSelected: true },
    })
    const headerCheckbox = wrapper.find('thead input[type="checkbox"]')
    expect((headerCheckbox.element as HTMLInputElement).checked).toBe(true)
  })

  it('shows focus score in focus variant', () => {
    const wrapper = mount(PropertyTable, { props: { items, variant: 'focus' } })
    expect(wrapper.text()).toContain('80')
    expect(wrapper.text()).toContain('60')
  })

  it('shows deviation percent in focus variant', () => {
    const wrapper = mount(PropertyTable, { props: { items, variant: 'focus' } })
    expect(wrapper.text()).toContain('-25%')
  })

  it('renders city labels correctly', () => {
    const wrapper = mount(PropertyTable, { props: { items } })
    expect(wrapper.text()).toContain('Москва')
    expect(wrapper.text()).toContain('МО')
  })
})
