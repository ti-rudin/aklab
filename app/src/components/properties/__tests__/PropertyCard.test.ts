import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PropertyCard from '../PropertyCard.vue'
import type { Property } from '@/composables/usePropertyData'
import { createRouter, createMemoryHistory } from 'vue-router'

const baseItem: Property = {
  id: 1,
  documentId: 'doc1',
  title: 'Тестовый объект',
  address: 'ул. Пушкина, 10',
  city: 'moscow',
  property_type: 'office',
  area_sqm: '100',
  price: '5000000',
  price_per_sqm: '50000',
  status: 'new',
  is_undervalued: false,
  deviation_percent: null,
  source: 'CIAN',
  focus_score: 75,
  tags: ['new', 'undervalued'],
  has_minimum_price: false,
}

function mountWithRouter(component: any, options: any = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/properties/:id', component: { template: '<div />' } }],
  })
  return mount(component, {
    ...options,
    global: {
      ...options.global,
      plugins: [router],
    },
  })
}

describe('PropertyCard', () => {
  it('always shows title', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem } })
    expect(wrapper.text()).toContain('Тестовый объект')
  })

  it('shows address, city, type, source in meta line', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem } })
    expect(wrapper.text()).toContain('ул. Пушкина, 10')
    expect(wrapper.text()).toContain('Москва') // cityLabel
    expect(wrapper.text()).toContain('Офис') // typeLabel
    expect(wrapper.text()).toContain('CIAN')
  })

  it('shows metric tiles (area, price, ₽/m²)', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem } })
    expect(wrapper.text()).toContain('Площадь')
    expect(wrapper.text()).toContain('100 м²')
    expect(wrapper.text()).toContain('Цена')
    expect(wrapper.text()).toContain('₽/м²')
  })

  it('default variant shows status badge', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'default' } })
    expect(wrapper.text()).toContain('Новый') // statusLabel for 'new'
  })

  it('default variant shows ⚠ badge when is_undervalued', () => {
    const item = { ...baseItem, is_undervalued: true, deviation_percent: '15' }
    const wrapper = mountWithRouter(PropertyCard, { props: { item } })
    expect(wrapper.text()).toContain('⚠')
    expect(wrapper.text()).toContain('15%')
  })

  it('default variant hides ⚠ badge when not undervalued', () => {
    const item = { ...baseItem, is_undervalued: false }
    const wrapper = mountWithRouter(PropertyCard, { props: { item } })
    expect(wrapper.text()).not.toContain('⚠')
  })

  it('focus variant shows checkbox', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'focus' } })
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true)
  })

  it('default variant does not show checkbox', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'default' } })
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('focus variant shows 4th metric (Скор)', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'focus' } })
    expect(wrapper.text()).toContain('Скор')
    expect(wrapper.text()).toContain('75')
  })

  it('focus variant shows tags', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'focus' } })
    // tagLabel('new') = 'Новый', tagLabel('undervalued') = 'Недооценён'
    expect(wrapper.text()).toContain('Недооценён')
  })

  it('focus variant shows deviation badge', () => {
    const item = { ...baseItem, deviation_percent: '-35' }
    const wrapper = mountWithRouter(PropertyCard, { props: { item, variant: 'focus' } })
    expect(wrapper.text()).toContain('-35%')
  })

  it('focus variant shows Торги badge when has_minimum_price is true', () => {
    const item = { ...baseItem, has_minimum_price: true }
    const wrapper = mountWithRouter(PropertyCard, { props: { item, variant: 'focus' } })
    expect(wrapper.text()).toContain('Торги')
  })

  it('focus variant shows Отклонить button always', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'focus', selected: false } })
    expect(wrapper.text()).toContain('Отклонить')
  })

  it('focus variant shows Просмотрено and CSV only when selected', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'focus', selected: true } })
    expect(wrapper.text()).toContain('Просмотрено')
    expect(wrapper.text()).toContain('Отклонить')
    expect(wrapper.text()).toContain('CSV')
  })

  it('focus variant hides Просмотрено and CSV when not selected', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'focus', selected: false } })
    expect(wrapper.text()).not.toContain('Просмотрено')
    expect(wrapper.text()).not.toContain('CSV')
  })

  it('renders as router-link with correct to prop', () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem } })
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('/properties/doc1')
  })

  it('emits toggle-select on checkbox change in focus variant', async () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'focus' } })
    await wrapper.find('input[type="checkbox"]').trigger('change')
    expect(wrapper.emitted('toggle-select')).toBeTruthy()
  })

  it('emits quick-reject when Отклонить button is clicked', async () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'focus' } })
    const rejectBtn = wrapper.findAll('button').find(b => b.text() === 'Отклонить')
    expect(rejectBtn).toBeTruthy()
    await rejectBtn!.trigger('click')
    expect(wrapper.emitted('quick-reject')).toBeTruthy()
  })

  it('emits bulk-status when Просмотрено button is clicked (selected)', async () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'focus', selected: true } })
    const buttons = wrapper.findAll('button')
    // "Отклонить" is first, "Просмотрено" is second
    await buttons[1].trigger('click')
    expect(wrapper.emitted('bulk-status')![0]).toEqual(['viewed'])
  })

  it('emits bulk-csv when CSV button is clicked', async () => {
    const wrapper = mountWithRouter(PropertyCard, { props: { item: baseItem, variant: 'focus', selected: true } })
    const buttons = wrapper.findAll('button')
    // CSV is the last button
    await buttons[buttons.length - 1].trigger('click')
    expect(wrapper.emitted('bulk-csv')).toBeTruthy()
  })
})
