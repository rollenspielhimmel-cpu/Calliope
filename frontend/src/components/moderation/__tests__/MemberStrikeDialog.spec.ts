import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import MemberStrikeDialog from '@/components/moderation/MemberStrikeDialog.vue'

/**
 * What the dialog proposes, and what it does with it. The ladder is a *suggestion* — the whole
 * point of the feature — so the two things worth pinning down are that the suggestion is read
 * out of `suggestNextAction` faithfully, and that it prefills without ever forcing the hand.
 */
const mocks = vi.hoisted(() => ({
  history: { value: { status: 200, data: [] as unknown[] } },
  suggestion: { value: undefined as unknown },
  warn: vi.fn<(variables: unknown) => Promise<void>>(),
  suspend: vi.fn<(variables: unknown) => Promise<void>>(),
  lift: vi.fn<(variables: unknown) => Promise<void>>(),
}))

/**
 * A real ref, not `{ value: false }`: a plain object is truthy, so `v-if="isPending"` would hold
 * the component on its spinner and hide what these assertions are about. Dereferenced only when a
 * hook is called, which keeps it out of the hoisted mock factory's dead zone.
 */
const notPending = ref(false)

vi.mock('@/api/moderation/moderation', () => ({
  useListStrikeHistory: () => ({ data: mocks.history, isPending: notPending }),
  useSuggestNextStrikeAction: () => ({ data: mocks.suggestion }),
  useIssueWarning: () => ({ mutateAsync: mocks.warn, isPending: notPending }),
  useIssueSuspension: () => ({ mutateAsync: mocks.suspend, isPending: notPending }),
  useLiftSuspension: () => ({ mutateAsync: mocks.lift, isPending: notPending }),
  getListStrikeHistoryQueryKey: () => ['strikes'],
  getSuggestNextStrikeActionQueryKey: () => ['suggestion'],
}))

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

function suggesting(suggestion: {
  priorWarnings: number
  priorSuspensions: number
  action: 'warning' | 'suspension'
  suggestedHours: number | null
  ladderExhausted: boolean
}) {
  mocks.suggestion.value = { status: 200, data: suggestion }
}

function strikeDialog() {
  return mount(MemberStrikeDialog, {
    props: { open: true, userId: 'a-user', username: 'federkiel' },
    shallow: true,
  })
}

function state(wrapper: ReturnType<typeof strikeDialog>) {
  return wrapper.vm as unknown as {
    suggestionText: string | undefined
    asSuspension: boolean
    hours: number
    severity: string
    reason: string
    error: string | undefined
    submit: () => Promise<void>
  }
}

beforeEach(() => {
  mocks.history.value = { status: 200, data: [] }
  mocks.suggestion.value = undefined
  mocks.warn.mockReset().mockResolvedValue(undefined)
  mocks.suspend.mockReset().mockResolvedValue(undefined)
  mocks.lift.mockReset().mockResolvedValue(undefined)
})

describe('MemberStrikeDialog', () => {
  it('proposes the first warning when nothing has been decided', () => {
    suggesting({
      priorWarnings: 0,
      priorSuspensions: 0,
      action: 'warning',
      suggestedHours: null,
      ladderExhausted: false,
    })

    expect(state(strikeDialog()).suggestionText).toBe('Vorschlag: erste Verwarnung.')
  })

  it('names the second warning and what would follow it', () => {
    suggesting({
      priorWarnings: 1,
      priorSuspensions: 0,
      action: 'warning',
      suggestedHours: null,
      ladderExhausted: false,
    })

    expect(state(strikeDialog()).suggestionText).toBe(
      'Vorschlag: zweite Verwarnung. Der nächste Verstoß wäre der 1. Strike.',
    )
  })

  it('proposes the rung of the ladder the history has reached', () => {
    suggesting({
      priorWarnings: 2,
      priorSuspensions: 1,
      action: 'suspension',
      suggestedHours: 48,
      ladderExhausted: false,
    })

    expect(state(strikeDialog()).suggestionText).toBe('Vorschlag: 2. Strike — 48 Stunden Sperrung.')
  })

  it('says when the ladder is walked out, without doing anything about it', () => {
    suggesting({
      priorWarnings: 2,
      priorSuspensions: 3,
      action: 'suspension',
      suggestedHours: 72,
      ladderExhausted: true,
    })

    // Deleting an account is its own decision through its own route; this only says so.
    expect(state(strikeDialog()).suggestionText).toBe(
      'Alle drei Strikes sind vergeben. Der nächste Schritt wäre laut Regelwerk die Löschung.',
    )
  })

  it('prefills the form from the suggestion, and leaves every part of it editable', async () => {
    suggesting({
      priorWarnings: 2,
      priorSuspensions: 0,
      action: 'suspension',
      suggestedHours: 24,
      ladderExhausted: false,
    })

    const vm = state(strikeDialog())
    await nextTick()

    expect(vm.asSuspension).toBe(true)
    expect(vm.hours).toBe(24)

    // A suspension may be answered with a warning after all: the ladder is not enforced.
    vm.asSuspension = false
    expect(vm.asSuspension).toBe(false)
  })

  it('records nothing without a reason', async () => {
    const wrapper = strikeDialog()
    const vm = state(wrapper)

    vm.reason = '   '
    await vm.submit()

    expect(mocks.warn).not.toHaveBeenCalled()
    expect(mocks.suspend).not.toHaveBeenCalled()
  })

  it('records a warning with the trimmed reason', async () => {
    const vm = state(strikeDialog())

    vm.severity = 'borderline'
    vm.asSuspension = false
    vm.reason = '  Wiederholt persönlich geworden  '
    await vm.submit()

    expect(mocks.warn).toHaveBeenCalledWith({
      userId: 'a-user',
      data: { severity: 'borderline', reason: 'Wiederholt persönlich geworden' },
    })
    expect(mocks.suspend).not.toHaveBeenCalled()
  })

  it('records a suspension with the hours, when that is what was chosen', async () => {
    const vm = state(strikeDialog())

    vm.severity = 'severe'
    vm.asSuspension = true
    vm.hours = 72
    vm.reason = 'Schwerwiegend'
    await vm.submit()

    expect(mocks.suspend).toHaveBeenCalledWith({
      userId: 'a-user',
      data: { severity: 'severe', reason: 'Schwerwiegend', hours: 72 },
    })
    expect(mocks.warn).not.toHaveBeenCalled()
  })

  it('lets a severe incident skip straight to a suspension with no warning behind it', async () => {
    // The suggestion says "first warning"; the operator decides otherwise, and that is allowed.
    suggesting({
      priorWarnings: 0,
      priorSuspensions: 0,
      action: 'warning',
      suggestedHours: null,
      ladderExhausted: false,
    })

    const vm = state(strikeDialog())
    await nextTick()

    expect(vm.asSuspension).toBe(false)

    vm.asSuspension = true
    vm.hours = 24
    vm.severity = 'severe'
    vm.reason = 'Sofort gesperrt'
    await vm.submit()

    expect(mocks.suspend).toHaveBeenCalled()
  })
})
