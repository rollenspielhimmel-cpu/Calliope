import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import BroadcastView from '@/views/moderation/BroadcastView.vue'

/**
 * Wen eine Rundmail erreicht — Rollen oder Namen, und beides zusammen.
 *
 * **Drei Ebenen sagten dreierlei.** Die Datenbank verlangte eine Rolle, die Schnittstelle Rollen
 * oder Namen, die Oberfläche wieder eine Rolle. Weil die äußeren beiden zufällig übereinstimmten,
 * fiel nichts auf: Die Rundmail an genau zwei Genannte, die die Schnittstelle versprach, war über
 * die Oberfläche schlicht nicht zu haben — der Knopf blieb grau, ohne zu sagen warum. Diese Datei
 * hält die Oberflächen-Hälfte fest; die Datenbank-Hälfte steht in
 * `database/test/broadcast_audience_test.ts`.
 */

function entry(overrides: Record<string, unknown>) {
  return {
    publicationId: '01900000-0000-7000-8000-000000000001',
    broadcastId: '01900000-0000-7000-8000-000000000002',
    status: 'awaiting_approval',
    subject: 'Zu zweit',
    body: 'Nur für euch beide.',
    audienceRoles: [],
    memberIds: [],
    namedRecipients: [],
    includeUnverified: false,
    deliverToInbox: true,
    deliverByEmail: false,
    publishInArchive: false,
    sendAsUserId: null,
    sendAsUsername: null,
    scheduledFor: null,
    writtenByUsername: 'federkiel',
    writtenAt: '2026-09-21T10:00:00.000Z',
    approvedByUsername: null,
    approvedAt: null,
    editedByUsername: null,
    editedAt: null,
    releasedAt: null,
    recipientCount: null,
    emailRecipientCount: null,
    archivePostId: null,
    ...overrides,
  }
}

const NAMES_ONLY = entry({
  memberIds: ['01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-00000000000b'],
  namedRecipients: [
    { id: '01900000-0000-7000-8000-00000000000a', username: 'eulenfeder' },
    { id: '01900000-0000-7000-8000-00000000000b', username: 'tintenfass' },
  ],
})

const queue = { value: { status: 200, data: [NAMES_ONLY] } }

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListBroadcastQueue: () => ({ data: queue }),
  useListReleasedBroadcasts: () => ({ data: { value: { status: 200, data: [] } } }),
  useListBroadcastSenders: () => ({ data: { value: { status: 200, data: [] } } }),
  useCountBroadcastRecipients: () => ({ data: { value: undefined }, isFetching: false }),
  useSubmitBroadcast: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
  useEditBroadcast: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
  useApproveBroadcast: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
  useDiscardBroadcast: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
}))

function broadcastView() {
  return mount(BroadcastView, {
    global: {
      stubs: {
        RouterLink: RouterLinkStub,
        // Der Rahmen der Moderationsseiten hängt an vue-query; hier geht es um das Formular darin.
        AppLayout: { template: '<div><slot /></div>' },
        // Der Namenswähler fragt den Server; die Namen kommen hier aus dem Eintrag.
        UserPicker: true,
      },
    },
  })
}

async function openQueue(wrapper: ReturnType<typeof broadcastView>) {
  const tab = wrapper.findAll('button').find((button) => button.text() === 'Warteschlange')
  if (tab === undefined) {
    throw new Error('kein Reiter „Warteschlange"')
  }
  await tab.trigger('click')
  await flushPromises()
}

describe('BroadcastView', () => {
  it('nennt in der Warteschlange die Namen, wenn es keine Rolle gibt', async () => {
    queue.value.data = [NAMES_ONLY]
    const wrapper = broadcastView()
    await openQueue(wrapper)

    // Vorher stand hier „An · Als Admin" — ein Wort, das ins Leere zeigt.
    expect(wrapper.text()).toContain('An eulenfeder, tintenfass')
  })

  it('nennt Rollen und Namen zusammen', async () => {
    // Die Namen fehlten auch schon neben einer Rolle: Wer „an die Moderation" las, sah nicht, dass
    // zwei Mitglieder sie zusätzlich bekommen.
    queue.value.data = [entry({ ...NAMES_ONLY, audienceRoles: ['moderator'] })]
    const wrapper = broadcastView()
    await openQueue(wrapper)

    expect(wrapper.text()).toContain('An Moderation, eulenfeder, tintenfass')
  })

  it('sagt es, wenn von den Genannten niemand mehr da ist', async () => {
    // Der eine Weg, auf dem die Zeile leer wird: Die Namen gehen mit ihren Konten.
    queue.value.data = [entry({})]
    const wrapper = broadcastView()
    await openQueue(wrapper)

    expect(wrapper.text()).toContain('An niemanden mehr')
  })

  it('lässt eine Rundmail nur an Namen abschicken', async () => {
    queue.value.data = [NAMES_ONLY]
    const wrapper = broadcastView()
    await openQueue(wrapper)

    const edit = wrapper.findAll('button').find((button) => button.text() === 'Bearbeiten')
    if (edit === undefined) {
      throw new Error('kein „Bearbeiten" an der wartenden Rundmail')
    }
    await edit.trigger('click')
    await flushPromises()

    const next = wrapper.findAll('button').find((button) => button.text() === 'Weiter')
    if (next === undefined) {
      throw new Error('kein „Weiter" im Formular')
    }

    // Betreff, Text und ein Weg sind gesetzt, eine Rolle nicht — und das muss reichen.
    expect(next.attributes('disabled')).toBeUndefined()
  })
})
