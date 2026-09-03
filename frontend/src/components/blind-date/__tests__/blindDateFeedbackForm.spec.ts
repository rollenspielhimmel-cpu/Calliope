import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import BlindDateFeedbackForm from '@/components/blind-date/BlindDateFeedbackForm.vue'

/**
 * The three questions after a Blind-Date.
 *
 * What is asserted here is the half that would rot quietly. **„Nein danke" has to send something** —
 * a decline that quietly sent nothing would leave the page asking after every ending for ever, and
 * nothing on screen would look wrong. **Half a form must not go**, because the API refuses it and
 * the refusal would reach somebody as an error rather than as a disabled button. And the opening
 * sentence has to match how the Blind-Date actually finished, since a form that opens with the
 * wrong one reads as a form nobody checked.
 */

const notPending = ref(false)
const send = vi.fn<(argument: unknown) => Promise<unknown>>().mockResolvedValue({ status: 200 })

vi.mock('@/api/blind-date/blind-date', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSubmitBlindDateFeedback: () => ({ mutateAsync: send, isPending: notPending }),
  getGetPendingBlindDateFeedbackQueryKey: () => ['feedback'],
}))

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

function form(wasRevealed = false) {
  return mount(BlindDateFeedbackForm, {
    props: {
      invitation: {
        pairId: 'pair-1',
        plotTitle: 'Der letzte Zug',
        wasRevealed,
        endedAt: '2026-09-02T20:00:00Z',
      },
    },
    global: { stubs: { teleport: true } },
  })
}

function button(wrapper: ReturnType<typeof form>, label: string) {
  return wrapper.findAll('button').find((each) => each.text() === label)!
}

/**
 * The two selects are reka-ui portals, and opening one in jsdom tests how reka renders rather than
 * what this form sends. The bindings are reached directly instead — cast because `<script setup>`
 * publishes nothing to the instance type, which is a fact about the compiler and not about the
 * component.
 */
function answers(wrapper: ReturnType<typeof form>) {
  return wrapper.vm as unknown as { worked: string; again: string; note: string }
}

describe('BlindDateFeedbackForm', () => {
  beforeEach(() => {
    send.mockClear()
  })

  it('opens with the ending that actually happened', () => {
    expect(form(false).text()).toContain('ist zu Ende gegangen')
    expect(form(true).text()).toContain('zu erkennen gegeben')
  })

  it('says the questions are not about the other person', () => {
    // Before the first question rather than in small print: somebody who reads this as a form
    // about their partner answers a different form.
    expect(form().text()).toContain('nicht um die andere Person')
  })

  it('sends nothing but the pair when it is declined', async () => {
    await button(form(), 'Nein danke').trigger('click')

    // Both answers absent is what the API reads as „nein danke", and it is what stops the asking.
    expect(send).toHaveBeenCalledWith({ data: { pairId: 'pair-1' } })
  })

  it('will not send half an answer', async () => {
    const wrapper = form()

    await wrapper.find('form').trigger('submit')

    expect(send).not.toHaveBeenCalled()
    expect(button(wrapper, 'Abschicken').attributes('disabled')).toBeDefined()
  })

  it('sends both answers and the note together', async () => {
    const wrapper = form()

    const chosen = answers(wrapper)
    chosen.worked = 'partly'
    chosen.again = 'yes'
    chosen.note = '  Der Anfang war zäh.  '
    await wrapper.vm.$nextTick()

    await wrapper.find('form').trigger('submit')

    expect(send).toHaveBeenCalledWith({
      data: {
        pairId: 'pair-1',
        worked: 'partly',
        again: 'yes',
        note: 'Der Anfang war zäh.',
      },
    })
  })

  it('leaves the note out when it is blank rather than sending an empty one', async () => {
    const wrapper = form()

    const chosen = answers(wrapper)
    chosen.worked = 'no'
    chosen.again = 'no'
    chosen.note = '   '
    await wrapper.vm.$nextTick()

    await wrapper.find('form').trigger('submit')

    expect(send).toHaveBeenCalledWith({
      data: { pairId: 'pair-1', worked: 'no', again: 'no' },
    })
  })
})
