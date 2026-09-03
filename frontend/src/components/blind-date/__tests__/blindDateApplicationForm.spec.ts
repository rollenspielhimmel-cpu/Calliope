import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import BlindDateApplicationForm from '@/components/blind-date/BlindDateApplicationForm.vue'

/**
 * The one field in the application form that changes shape.
 *
 * Where the team named the roles of an offered plot, applying means choosing one of them — the
 * whole reason for naming them is that four people describing the same role in four ways cannot be
 * matched against each other. Where it named none, and for a proactive application, which has no
 * list to choose from, the field stays the free text it always was.
 *
 * The role is also cleared when the offer changes: „Die Wirtin" carried across to another plot
 * would submit a role that plot does not have, and the server would refuse it.
 */

const notPending = ref(false)
const apply = vi.fn<(argument: unknown) => Promise<unknown>>().mockResolvedValue({ status: 200 })

vi.mock('@/api/blind-date/blind-date', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCreateBlindDateApplication: () => ({ mutateAsync: apply, isPending: notPending }),
}))

function offer(roles: string[]) {
  return {
    id: 'offer-1',
    title: 'Whispers of Eldermere',
    description: 'Ein Plot zum Testen.',
    roles,
    closesAt: null,
    pairing: null,
    genres: [] as string[],
    createdAt: '2026-09-01T10:00:00Z',
  }
}

function form(props: Record<string, unknown> = {}) {
  return mount(BlindDateApplicationForm, {
    props,
    global: { stubs: { teleport: true, RouterLink: true } },
  })
}

describe('BlindDateApplicationForm', () => {
  beforeEach(() => {
    apply.mockClear()
  })

  it('asks for the role in prose when no offer names any', () => {
    const wrapper = form()

    expect(wrapper.find('input#blindDateRole').exists()).toBe(true)
    expect(wrapper.text()).toContain('Geschlecht deiner Rolle')
  })

  it('keeps the prose field for an offer that names none', () => {
    const wrapper = form({ offer: offer([]) })

    expect(wrapper.find('input#blindDateRole').exists()).toBe(true)
  })

  it('offers the named roles as a choice instead', () => {
    const wrapper = form({ offer: offer(['Die Wirtin', 'Der Fremde']) })

    // No free-text input at all: leaving one beside the list would be two answers to one question.
    expect(wrapper.find('input#blindDateRole').exists()).toBe(false)
    expect(wrapper.text()).toContain('Rolle')
    expect(wrapper.find('#blindDateRole').exists()).toBe(true)
  })

  it('will not submit until a role is chosen', async () => {
    const wrapper = form({ offer: offer(['Die Wirtin']) })

    await wrapper.find('#blindDatePairing').setValue('offen')
    await wrapper.find('form').trigger('submit')

    expect(apply).not.toHaveBeenCalled()
  })

  it('forgets the chosen role when the offer changes', async () => {
    const wrapper = form({ offer: offer(['Die Wirtin']) })

    // Set through the component rather than the portal: what is under test is that changing the
    // offer clears it, not how reka-ui opens a listbox.
    wrapper.vm.roleGender = 'Die Wirtin'
    // Asserted before the change, so a field that never took the value cannot pass this by
    // sitting empty from the start.
    expect(wrapper.vm.roleGender).toBe('Die Wirtin')

    await wrapper.setProps({ offer: { ...offer(['Der Wirt']), id: 'offer-2' } })

    expect(wrapper.vm.roleGender).toBe('')
  })
})
