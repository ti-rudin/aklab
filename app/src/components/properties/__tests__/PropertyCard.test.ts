import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PropertyCard from '../PropertyCard.vue'
import type { Property } from '@/composables/usePropertyData'

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

describe('PropertyCard', () => {
  it('always shows title', () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem } })
    expect(wrapper.text()).toContain('Тестовый объект')
  })

  it('shows address, city, type, source in meta line', () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem } })
    expect(wrapper.text()).toContain('ул. Пушкина, 10')
    expect(wrapper.text()).toContain('Москва') // cityLabel
    expect(wrapper.text()).toContain('Офис') // typeLabel
    expect(wrapper.text()).toContain('CIAN')
  })

  it('shows metric tiles (area, price, ₽/m²)', () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem } })
    expect(wrapper.text()).toContain('Площадь')
    expect(wrapper.text()).toContain('100 м²')
    expect(wrapper.text()).toContain('Цена')
    expect(wrapper.text()).toContain('₽/м²')
  })

  it('default variant shows status badge', () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem, variant: 'default' } })
    expect(wrapper.text()).toContain('Новый') // statusLabel for 'new'
  })

  it('default variant shows ⚠ badge when is_undervalued', () => {
    const item = { ...baseItem, is_undervalued: true, deviation_percent: '15' }
    const wrapper = mount(PropertyCard, { props: { item } })
    expect(wrapper.text()).toContain('⚠')
    expect(wrapper.text()).toContain('15%')
  })

  it('default variant hides ⚠ badge when not undervalued', () => {
    const item = { ...baseItem, is_undervalued: false }
    const wrapper = mount(PropertyCard, { props: { item } })
    expect(wrapper.text()).not.toContain('⚠')
  })

  it('focus variant shows checkbox', () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem, variant: 'focus' } })
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true)
  })

  it('default variant does not show checkbox', () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem, variant: 'default' } })
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('focus variant shows 4th metric (Скор)', () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem, variant: 'focus' } })
    expect(wrapper.text()).toContain('Скор')
    expect(wrapper.text()).toContain('75')
  })

  it('focus variant shows tags', () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem, variant: 'focus' } })
    // tagLabel('new') = 'Новый', tagLabel('undervalued') = 'Недооценён'
    expect(wrapper.text()).toContain('Недооценён')
  })

  it('focus variant shows deviation badge', () => {
    const item = { ...baseItem, deviation_percent: '-35' }
    const wrapper = mount(PropertyCard, { props: { item, variant: 'focus' } })
    expect(wrapper.text()).toContain('-35%')
  })

  it('focus variant shows Торги badge when has_minimum_price is true', () => {
    const item = { ...baseItem, has_minimum_price: true }
    const wrapper = mount(PropertyCard, { props: { item, variant: 'focus' } })
    expect(wrapper.text()).toContain('Торги')
  })

  it('focus variant shows action buttons when selected', () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem, variant: 'focus', selected: true } })
    expect(wrapper.text()).toContain('Просмотрено')
    expect(wrapper.text()).toContain('Отклонить')
    expect(wrapper.text()).toContain('CSV')
  })

  it('focus variant hides action buttons when not selected', () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem, variant: 'focus', selected: false } })
    expect(wrapper.text()).not.toContain('Просмотрено')
    expect(wrapper.text()).not.toContain('Отклонить')
    expect(wrapper.text()).not.toContain('CSV')
  })

  it('emits open on card click', async () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem } })
    await wrapper.find('div').trigger('click')
    expect(wrapper.emitted('open')).toBeTruthy()
  })

  it('emits toggle-select on checkbox change in focus variant', async () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem, variant: 'focus' } })
    await wrapper.find('input[type="checkbox"]').trigger('change')
    expect(wrapper.emitted('toggle-select')).toBeTruthy()
  })

  it('emits bulk-status when action button is clicked', async () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem, variant: 'focus', selected: true } })
    const buttons = wrapper.findAll('button')
    // first button is "Просмотрено"
    await buttons[0].trigger('click')
    expect(wrapper.emitted('bulk-status')![0]).toEqual(['viewed'])
  })

  it('emits bulk-csv when CSV button is clicked', async () => {
    const wrapper = mount(PropertyCard, { props: { item: baseItem, variant: 'focus', selected: true } })
    const buttons = wrapper.findAll('button')
    // CSV is the last button
    await buttons[buttons.length - 1].trigger('click')
    expect(wrapper.emitted('bulk-csv')).toBeTruthy()
  })
})
