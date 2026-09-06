import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import AdminInboxView from '@/views/moderation/AdminInboxView.vue'

/**
 * Das Postfach der Administration.
 *
 * **Zwei Dinge, die ohne Test still kaputtgehen.** „Offen" ist keine Marke, die jemand setzt,
 * sondern eine Aussage über den Verlauf — steht sie an der falschen Zeile, arbeitet man den
 * falschen Stapel ab. Und der Verweis aus „Gesendete" führt hierher mit einem Gespräch in der
 * Adresse; wird der nicht gelesen, landet man auf einer Liste und sucht von vorn.
 */

const OPEN = {
  chatGroupId: '01900000-0000-7000-8000-000000000001',
  username: 'federkiel',
  excerpt: 'Ich hätte da eine Frage.',
  lastMessageAt: '2026-09-06T10:00:00.000Z',
  awaitingReply: true,
  broadcastId: '01900000-0000-7000-8000-0000000000ff',
}

const ANSWERED = {
  chatGroupId: '01900000-0000-7000-8000-000000000002',
  username: 'tintenfleck',
  excerpt: 'Danke, alles klar.',
  lastMessageAt: '2026-09-05T10:00:00.000Z',
  awaitingReply: false,
  broadcastId: null,
}

const CONVERSATION = {
  chatGroupId: OPEN.chatGroupId,
  username: OPEN.username,
  broadcastId: OPEN.broadcastId,
  messages: [
    {
      id: '01900000-0000-7000-8000-00000000000a',
      // **Absichtlich nicht derselbe Text wie der Auszug.** Er stand hier einmal gleich, und dann
      // fand die Prüfung unten ihn in der Liste statt im Verlauf: Der Test blieb grün, als ich das
      // Aufschlagen versuchsweise ausbaute. Ein Test, der nicht ausschlägt, prüft nichts.
      text: 'Ich hätte da eine Frage, und zwar diese.',
      createdAt: '2026-09-06T10:00:00.000Z',
      username: OPEN.username,
      fromTeam: false,
      writtenByUsername: null,
    },
  ],
}

const inbox = { value: { status: 200, data: { results: [OPEN, ANSWERED] } } }
const conversation = { value: { status: 200, data: CONVERSATION } }

const query: { conversation?: string } = {}

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRoute: () => ({ query }),
}))

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListAdminInbox: () => ({ data: inbox, isPending: false }),
  useReadAdminInboxConversation: () => ({ data: conversation }),
}))

function inboxView() {
  return mount(AdminInboxView, {
    global: {
      stubs: {
        RouterLink: RouterLinkStub,
        // Der Rahmen der Moderationsseiten hängt an vue-query; hier geht es um die Liste darin.
        AppLayout: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('AdminInboxView', () => {
  it('nennt offen, was noch keine Antwort hat — und nur das', async () => {
    delete query.conversation

    const wrapper = inboxView()
    await flushPromises()

    const rows = wrapper.findAll('li')
    expect(rows).toHaveLength(2)

    // Die Aussage hängt an der Zeile, nicht an der Seite: Sonst arbeitet man den falschen Stapel ab.
    expect(rows[0]?.text()).toContain('offen')
    expect(rows[1]?.text()).not.toContain('offen')
  })

  it('schlägt das Gespräch auf, das die Adresse nennt', async () => {
    query.conversation = OPEN.chatGroupId

    const wrapper = inboxView()
    await flushPromises()

    // Der Verweis aus „Gesendete" führt hierher. Ohne dieses Aufschlagen landet man auf einer
    // Liste und sucht das Gespräch von vorn.
    expect(wrapper.findAllComponents({ name: 'TeamConversation' })).toHaveLength(1)
    expect(wrapper.text()).toContain('Ich hätte da eine Frage, und zwar diese.')
  })

  it('schlägt ohne Gespräch in der Adresse keines auf', async () => {
    delete query.conversation

    const wrapper = inboxView()
    await flushPromises()

    // Der Auszug steht in der Liste, der Verlauf nicht — sonst prüfte der Test oben nichts.
    expect(wrapper.findAllComponents({ name: 'TeamConversation' })).toHaveLength(0)
  })
})
