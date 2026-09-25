import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { VueQueryPlugin } from '@tanstack/vue-query'
import StatusSettingsDialog from '@/components/status/StatusSettingsDialog.vue'

/**
 * Die Einstellungen der Statusmeldungen.
 *
 * **Blockierte stehen mit in der Liste.** Blockieren regelt Kontakt, Ausblenden regelt Sicht; wer
 * blockiert ist, verschwindet deshalb nicht von selbst aus den Statusmeldungen. Ohne den Vermerk
 * wäre das ein Rätsel — mit ihm ist es ein Klick.
 */

const hidden = {
  userId: 'u2',
  username: 'lautsprecher',
  hideUpdates: true,
  hideComments: false,
}

const setHidden = vi.fn<(...args: unknown[]) => Promise<unknown>>()

vi.mock('@/api/status-updates/status-updates', () => ({
  useListHiddenStatusMembers: () => ({
    data: ref({ status: 200, data: { results: [hidden] } }),
    refetch: () => Promise.resolve(),
  }),
  setHiddenStatusMember: (...args: unknown[]) => setHidden(...args),
  getListStatusUpdatesQueryKey: () => ['QUERY', 'api', 'status-updates', {}],
  listStatusUpdates: () =>
    Promise.resolve({ status: 200, data: { results: [], nextCursor: null } }),
}))

vi.mock('@/api/blocks/blocks', () => ({
  useListBlocks: () => ({
    data: ref({
      status: 200,
      data: {
        results: [
          { blockedId: 'u3', username: 'streitfall', createdAt: '2026-09-01T00:00:00.000Z' },
        ],
      },
    }),
  }),
}))

vi.mock('@/components/user/UserPicker.vue', () => ({
  default: { template: '<div data-picker />' },
}))

beforeEach(() => {
  setHidden.mockReset()
  setHidden.mockResolvedValue({ status: 200, data: { results: [] } })
  document.body.innerHTML = ''
})

async function openDialog() {
  const wrapper = mount(StatusSettingsDialog, {
    global: { plugins: [VueQueryPlugin], stubs: { RouterLink: RouterLinkStub } },
    attachTo: document.body,
  })
  await wrapper.find('button').trigger('click')
  await flushPromises()
  return wrapper
}

describe('Die Einstellungen der Statusmeldungen', () => {
  it('zeigt Ausgeblendete und Blockierte in einer Liste', async () => {
    await openDialog()
    const shown = document.body.textContent ?? ''

    expect(shown).toContain('lautsprecher')
    // Der Vermerk erklärt, warum jemand trotzdem sichtbar ist.
    expect(shown).toContain('streitfall')
    expect(shown).toContain('blockiert')
  })

  /** Zwei Schalter, nicht einer: Meldungen und Kommentare gehen einzeln. */
  it('schaltet die beiden getrennt', async () => {
    await openDialog()

    const boxes = [...document.body.querySelectorAll('button[role="checkbox"]')]
    expect(boxes.length).toBeGreaterThanOrEqual(2)

    // Die zweite Schaltfläche der ersten Zeile: die Kommentare, die noch nicht ausgeblendet sind.
    boxes[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(setHidden).toHaveBeenCalledWith('u2', { hideUpdates: true, hideComments: true })
  })
})
