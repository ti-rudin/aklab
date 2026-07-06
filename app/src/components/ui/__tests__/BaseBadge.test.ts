import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseBadge from '../BaseBadge.vue'

describe('BaseBadge', () => {
  it('renders slot content', () => {
    const wrapper = mount(BaseBadge, {
      slots: { default: 'Active' },
    })
    expect(wrapper.text()).toContain('Active')
  })

  it('renders as a span element', () => {
    const wrapper = mount(BaseBadge)
    expect(wrapper.element.tagName).toBe('SPAN')
  })

  it('has pill shape (rounded-full)', () => {
    const wrapper = mount(BaseBadge)
    expect(wrapper.classes()).toContain('rounded-full')
  })

  it('applies md size classes by default', () => {
    const wrapper = mount(BaseBadge)
    expect(wrapper.classes()).toContain('px-2.5')
    expect(wrapper.classes()).toContain('py-1')
    expect(wrapper.classes()).toContain('text-xs')
  })

  it('applies sm size classes', () => {
    const wrapper = mount(BaseBadge, {
      props: { size: 'sm' },
    })
    expect(wrapper.classes()).toContain('px-2')
    expect(wrapper.classes()).toContain('py-0.5')
    expect(wrapper.classes()).toContain('text-xs')
  })

  it('applies neutral variant class by default', () => {
    const wrapper = mount(BaseBadge)
    expect(wrapper.classes()).toContain('badge-neutral')
  })

  it('applies success variant class', () => {
    const wrapper = mount(BaseBadge, {
      props: { variant: 'success' },
    })
    expect(wrapper.classes()).toContain('badge-success')
  })

  it('applies warning variant class', () => {
    const wrapper = mount(BaseBadge, {
      props: { variant: 'warning' },
    })
    expect(wrapper.classes()).toContain('badge-warning')
  })

  it('applies danger variant class', () => {
    const wrapper = mount(BaseBadge, {
      props: { variant: 'danger' },
    })
    expect(wrapper.classes()).toContain('badge-danger')
  })

  it('applies info variant class', () => {
    const wrapper = mount(BaseBadge, {
      props: { variant: 'info' },
    })
    expect(wrapper.classes()).toContain('badge-info')
  })

  it('has inline-flex and items-center for alignment', () => {
    const wrapper = mount(BaseBadge)
    expect(wrapper.classes()).toContain('inline-flex')
    expect(wrapper.classes()).toContain('items-center')
  })

  it('has font-medium class', () => {
    const wrapper = mount(BaseBadge)
    expect(wrapper.classes()).toContain('font-medium')
  })
})
