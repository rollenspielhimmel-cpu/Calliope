import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import BlockedWordsPanel from '@/components/moderation/BlockedWordsPanel.vue'

/**
 * What the panel tells somebody before they add a word.
 *
 * The two sentences under test are not decoration. Whoever types a word here has to know that it
 * is **reversible** — otherwise the list gets used timidly or not at all — and that it matches
 * **inside** words, which is the one way this feature surprises people. Both are consequences of
 * the design, and the person at the keyboard is the only one who can judge the second.
 */

const notPending = ref(false)

const words = {
  value: {
    status: 200,
    data: [
      {
        word: 'kuddelmuddel',
        note: 'Beispiel',
        addedAt: '2026-09-01T10:00:00Z',
        addedBy: { id: 'u1', username: 'aufsicht' },
      },
    ],
  },
}

const block = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })
const unblock = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListBlockedWords: () => ({ data: words, isPending: notPending }),
  useBlockWord: () => ({ mutateAsync: block, isPending: notPending }),
  useUnblockWord: () => ({ mutateAsync: unblock, isPending: notPending }),
  getListBlockedWordsQueryKey: () => ['words'],
}))

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

const panel = () => mount(BlockedWordsPanel)

beforeEach(() => {
  block.mockClear()
  unblock.mockClear()
})

describe('BlockedWordsPanel', () => {
  it('says that the original text is kept and that removing a word undoes the masking', () => {
    const text = panel().text()

    expect(text).toContain('ursprüngliche Text bleibt unverändert gespeichert')
    expect(text).toContain('wieder normal lesbar')
    expect(text).toContain('rückwirkend')
  })

  it('warns that the match reaches inside words', () => {
    // The trap of substring matching, said where somebody can act on it.
    expect(panel().text()).toContain('auch innerhalb von Wörtern')
  })

  it('lists a word with its note and who added it', () => {
    const text = panel().text()

    expect(text).toContain('kuddelmuddel')
    expect(text).toContain('Beispiel')
    expect(text).toContain('aufsicht')
  })

  it('sends a word lower-cased and trimmed', async () => {
    const wrapper = panel()

    await wrapper.find('input[aria-label="Wort"]').setValue('  Kuddelmuddel  ')
    await wrapper.find('form').trigger('submit')

    expect(block).toHaveBeenCalledWith({ data: { word: 'kuddelmuddel' } })
  })

  it('refuses to send a single letter rather than letting the API say no', async () => {
    // Two characters is the floor. Below it the entry stops being a word and starts masking the
    // middle of half the dictionary — the API refuses too, but not after a round trip.
    const wrapper = panel()

    await wrapper.find('input[aria-label="Wort"]').setValue('e')
    await wrapper.find('form').trigger('submit')

    expect(block).not.toHaveBeenCalled()
  })

  it('sends the note only when one was typed', async () => {
    const wrapper = panel()

    await wrapper.find('input[aria-label="Wort"]').setValue('quatschkram')
    await wrapper.find('input[aria-label="Notiz, optional"]').setValue('  weil  ')
    await wrapper.find('form').trigger('submit')

    expect(block).toHaveBeenCalledWith({ data: { word: 'quatschkram', note: 'weil' } })
  })
})
