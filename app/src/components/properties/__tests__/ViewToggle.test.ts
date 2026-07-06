import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ViewToggle from '../ViewToggle.vue'

describe('ViewToggle', () => {
  it('renders two buttons', () => {
    const wrapper = mount(ViewToggle, { props: { modelValue: 'cards' } })
    expect(wrapper.findAll('button')).toHaveLength(2)
  })

  it('first button emits cards, second emits table', async () => {
    const wrapper = mount(ViewToggle, { props: { modelValue: 'cards' } })
    const buttons = wrapper.findAll('button')

    await buttons[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')![0]).toEqual(['table'])

    await buttons[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')![1]).toEqual(['cards'])
  })

  it('active button has accent background style', () => {
    const wrapper = mount(ViewToggle, { props: { modelValue: 'cards' } })
    const buttons = wrapper.findAll('button')
    expect(buttons[0].attributes('style')).toContain('var(--accent)')
    // inactive button should not have accent background
    expect(buttons[1].attributes('style')).not.toContain('var(--accent)')
  })

  it('table button is active when modelValue is table', () => {
    const wrapper = mount(ViewToggle, { props: { modelValue: 'table' } })
    const buttons = wrapper.findAll('button')
    expect(buttons[0].attributes('style')).not.toContain('var(--accent)')
    expect(buttons[1].attributes('style')).toContain('var(--accent)')
  })
})
