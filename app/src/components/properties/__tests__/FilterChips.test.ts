import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FilterChips from '../FilterChips.vue'

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

describe('FilterChips', () => {
  it('renders one label per option', () => {
    const wrapper = mount(FilterChips, { props: { modelValue: [], options } })
    expect(wrapper.findAll('label')).toHaveLength(3)
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('Beta')
    expect(wrapper.text()).toContain('Gamma')
  })

  it('emits update:modelValue with added value when inactive chip is clicked', async () => {
    const wrapper = mount(FilterChips, { props: { modelValue: [], options } })
    await wrapper.findAll('label')[0].find('input').trigger('change')
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([['a']])
  })

  it('emits update:modelValue with removed value when active chip is clicked', async () => {
    const wrapper = mount(FilterChips, { props: { modelValue: ['a', 'b'], options } })
    await wrapper.findAll('label')[0].find('input').trigger('change')
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([['b']])
  })

  it('checkboxes reflect modelValue state', () => {
    const wrapper = mount(FilterChips, { props: { modelValue: ['b'], options } })
    const inputs = wrapper.findAll('input[type="checkbox"]')
    expect((inputs[0].element as HTMLInputElement).checked).toBe(false)
    expect((inputs[1].element as HTMLInputElement).checked).toBe(true)
    expect((inputs[2].element as HTMLInputElement).checked).toBe(false)
  })
})
