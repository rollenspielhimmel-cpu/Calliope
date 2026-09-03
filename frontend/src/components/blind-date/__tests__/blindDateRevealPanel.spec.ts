import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import BlindDateRevealPanel from '@/components/blind-date/BlindDateRevealPanel.vue'

/**
 * What the panel says in each of the three states, and that it only ever appears for the group it
 * belongs to.
 *
 * The wording is the substance here. „Die andere Person möchte" has to read as a fact somebody is
 * entitled to know before answering, not as a nudge — and the panel has to say that revealing does
 * not publish the group, because that is the fear that would otherwise stop people.
 */

const notPending = ref(false)

const own = {
  value: {
    status: 200,
    data: {
      writingGroupId: 'group-1',
      plotTitle: 'Whispers of Eldermere',
      matchedAt: '2026-09-01T10:00:00Z',
      // Past the threshold by default: most of these tests are about the three consent states,
      // and the two that are about the threshold set it themselves.
      rpgPosts: 50,
      postsBeforeReveal: 50,
      mayReveal: true,
      iAgreed: false,
      otherAgreed: false,
    },
  },
}

const agree = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })
const takeBack = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })
const endIt = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })

vi.mock('@/api/blind-date/blind-date', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetOwnBlindDate: () => ({ data: own, isPending: notPending }),
  useAgreeToBlindDateReveal: () => ({ mutateAsync: agree, isPending: notPending }),
  useWithdrawBlindDateRevealConsent: () => ({ mutateAsync: takeBack, isPending: notPending }),
  useEndOwnBlindDate: () => ({ mutateAsync: endIt, isPending: notPending }),
  getGetOwnBlindDateQueryKey: () => ['mine'],
  getGetPendingBlindDateFeedbackQueryKey: () => ['feedback'],
}))

vi.mock('@/api/groups/groups', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getGetGroupQueryKey: () => ['group'],
}))

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

const panel = (groupId = 'group-1') => mount(BlindDateRevealPanel, { props: { groupId } })

beforeEach(() => {
  agree.mockClear()
  takeBack.mockClear()
  own.value = {
    status: 200,
    data: {
      writingGroupId: 'group-1',
      plotTitle: 'Whispers of Eldermere',
      matchedAt: '2026-09-01T10:00:00Z',
      // Past the threshold: the tests about the threshold set their own.
      rpgPosts: 50,
      postsBeforeReveal: 50,
      mayReveal: true,
      iAgreed: false,
      otherAgreed: false,
    },
  }
})

describe('BlindDateRevealPanel', () => {
  it('draws nothing on a group that is not this member’s Blind-Date', () => {
    // Somebody may be in a Blind-Date and reading an ordinary group at the same time.
    expect(panel('another-group').find('section').exists()).toBe(false)
  })

  it('offers the choice while neither has answered', () => {
    const wrapper = panel()

    expect(wrapper.text()).toContain('Ihr schreibt anonym')
    expect(wrapper.text()).toContain('Ich möchte mich zu erkennen geben')
  })

  it('says the group stays private, in every state', () => {
    // The fear that would otherwise stop people, answered before it is asked.
    expect(panel().text()).toContain('Die Gruppe bleibt privat')
  })

  it('says somebody is waiting on you, flatly', () => {
    own.value.data.otherAgreed = true

    const text = panel().text()

    expect(text).toContain('Die andere Person möchte sich zu erkennen geben')
    // A fact, not a nudge: nothing here asks the reader to hurry.
    expect(text).toContain('Es passiert erst, wenn du es auch möchtest')
  })

  it('lets somebody take it back once they have agreed', async () => {
    own.value.data.iAgreed = true

    const wrapper = panel()

    expect(wrapper.text()).toContain('Du möchtest euch zu erkennen geben')
    expect(wrapper.text()).not.toContain('Ich möchte mich zu erkennen geben')

    await wrapper.find('button').trigger('click')
    expect(takeBack).toHaveBeenCalled()
  })

  it('agrees when the button is pressed', async () => {
    const wrapper = panel()

    await wrapper.find('button').trigger('click')

    expect(agree).toHaveBeenCalled()
    expect(takeBack).not.toHaveBeenCalled()
  })

  it('never names the other person', () => {
    own.value.data.otherAgreed = true

    // Nothing in any state may carry a name — the API does not return one, and this is the last
    // place it could be introduced by hand.
    expect(panel().text()).not.toMatch(/Partner \d/u)
  })
})

describe('BlindDateRevealPanel, before the threshold', () => {
  it('names how many posts are missing rather than only greying out', () => {
    own.value = {
      status: 200,
      data: {
        ...own.value.data,
        rpgPosts: 38,
        postsBeforeReveal: 50,
        mayReveal: false,
      },
    }

    const wrapper = panel()

    // A disabled control with no reason attached reads as a fault in the page; a number reads
    // as a rule.
    expect(wrapper.text()).toContain('Noch 12 Beiträge')
    // And the sentence that stops anybody trying to talk their way there.
    expect(wrapper.text()).toContain('Die anderen Threads zählen dafür nicht')
  })

  it('shuts the button until then', () => {
    own.value = {
      status: 200,
      data: { ...own.value.data, rpgPosts: 49, postsBeforeReveal: 50, mayReveal: false },
    }

    const wrapper = panel()
    const button = wrapper.findAll('button').find((one) => one.text().includes('zu erkennen geben'))

    expect(button?.attributes('disabled')).toBeDefined()
  })

  it('counts one missing post as one', () => {
    own.value = {
      status: 200,
      data: { ...own.value.data, rpgPosts: 49, postsBeforeReveal: 50, mayReveal: false },
    }

    expect(panel().text()).toContain('Noch 1 Beitrag im RPG-Thread')
  })
})
