import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseButton from '../BaseButton.vue'

describe('BaseButton', () => {
  it('renders slot content', () => {
    const wrapper = mount(BaseButton, {
      slots: { default: 'Click me' },
    })
    expect(wrapper.text()).toContain('Click me')
  })

  it('renders as a button element', () => {
    const wrapper = mount(BaseButton)
    expect(wrapper.element.tagName).toBe('BUTTON')
  })

  it('applies primary variant class by default', () => {
    const wrapper = mount(BaseButton)
    expect(wrapper.classes()).toContain('btn-v-primary')
  })

  it('applies secondary variant class', () => {
    const wrapper = mount(BaseButton, {
      props: { variant: 'secondary' },
    })
    expect(wrapper.classes()).toContain('btn-v-secondary')
  })

  it('applies ghost variant class', () => {
    const wrapper = mount(BaseButton, {
      props: { variant: 'ghost' },
    })
    expect(wrapper.classes()).toContain('btn-v-ghost')
  })

  it('applies danger variant class', () => {
    const wrapper = mount(BaseButton, {
      props: { variant: 'danger' },
    })
    expect(wrapper.classes()).toContain('btn-v-danger')
  })

  it('applies md size classes by default', () => {
    const wrapper = mount(BaseButton)
    expect(wrapper.classes()).toContain('px-4')
    expect(wrapper.classes()).toContain('py-2')
    expect(wrapper.classes()).toContain('text-sm')
  })

  it('applies sm size classes', () => {
    const wrapper = mount(BaseButton, {
      props: { size: 'sm' },
    })
    expect(wrapper.classes()).toContain('px-3')
    expect(wrapper.classes()).toContain('py-1.5')
    expect(wrapper.classes()).toContain('text-xs')
  })

  it('is disabled when disabled prop is true', () => {
    const wrapper = mount(BaseButton, {
      props: { disabled: true },
    })
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.classes()).toContain('opacity-50')
    expect(wrapper.classes()).toContain('cursor-not-allowed')
  })

  it('is disabled when loading prop is true', () => {
    const wrapper = mount(BaseButton, {
      props: { loading: true },
    })
    expect(wrapper.attributes('disabled')).toBeDefined()
  })

  it('shows spinner when loading', () => {
    const wrapper = mount(BaseButton, {
      props: { loading: true },
    })
    const spinner = wrapper.find('.animate-spin')
    expect(spinner.exists()).toBe(true)
  })

  it('does not show spinner when not loading', () => {
    const wrapper = mount(BaseButton)
    const spinner = wrapper.find('.animate-spin')
    expect(spinner.exists()).toBe(false)
  })

  it('has common utility classes', () => {
    const wrapper = mount(BaseButton)
    expect(wrapper.classes()).toContain('inline-flex')
    expect(wrapper.classes()).toContain('items-center')
    expect(wrapper.classes()).toContain('justify-center')
    expect(wrapper.classes()).toContain('gap-2')
    expect(wrapper.classes()).toContain('rounded-lg')
    expect(wrapper.classes()).toContain('font-medium')
  })
})
