import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import AdminInboxView from '@/views/moderation/AdminInboxView.vue'

/**
 * Das Postfach der Administration.
 *
 * **Drei Dinge, die ohne Test still kaputtgehen.** „Offen" ist keine Marke, die jemand setzt,
 * sondern eine Aussage über den Verlauf — steht sie an der falschen Zeile, arbeitet man den
 * falschen Stapel ab. Der Absender gehört in die Zeile, weil dasselbe Mitglied hier zweimal stehen
 * kann, sobald eine Kunstfigur geschrieben hat. Und das Antwortfeld darf den Text erst nach dem
 * Erfolg vergessen — siehe `StatusFeed.spec.ts`, wo genau das einmal schiefging.
 */

const OPEN = {
  chatGroupId: '01900000-0000-7000-8000-000000000001',
  username: 'federkiel',
  senderUsername: 'Admin',
  excerpt: 'Ich hätte da eine Frage.',
  lastMessageAt: '2026-09-06T10:00:00.000Z',
  awaitingReply: true,
}

const ANSWERED = {
  chatGroupId: '01900000-0000-7000-8000-000000000002',
  username: 'federkiel',
  senderUsername: 'Weihnachtsmann',
  excerpt: 'Danke, alles klar.',
  lastMessageAt: '2026-09-05T10:00:00.000Z',
  awaitingReply: false,
}

const CONVERSATION = {
  chatGroupId: OPEN.chatGroupId,
  username: OPEN.username,
  senderUsername: OPEN.senderUsername,
  messages: [
    {
      id: '01900000-0000-7000-8000-00000000000a',
      text: 'Wir machen am Wochenende Wartung.',
      createdAt: '2026-09-06T09:00:00.000Z',
      username: 'Admin',
      fromTeam: true,
      isAnnouncement: true,
      subject: 'Wartung',
      writtenByUsername: null,
    },
    {
      id: '01900000-0000-7000-8000-00000000000b',
      // **Absichtlich nicht derselbe Text wie der Auszug.** Er stand hier einmal gleich, und dann
      // fand die Prüfung ihn in der Liste statt im Verlauf: Der Test blieb grün, als das
      // Aufschlagen versuchsweise ausgebaut wurde. Ein Test, der nicht ausschlägt, prüft nichts.
      text: 'Ich hätte da eine Frage, und zwar diese.',
      createdAt: '2026-09-06T10:00:00.000Z',
      username: OPEN.username,
      fromTeam: false,
      isAnnouncement: false,
      subject: null,
      writtenByUsername: null,
    },
  ],
}

const inbox = { value: { status: 200, data: { results: [OPEN, ANSWERED] } } }
const conversation = { value: { status: 200, data: CONVERSATION } }

const sendReply = vi.fn<(...args: unknown[]) => Promise<unknown>>()

// Aufgefaltet statt ersetzt: Die Datei liest aus demselben Modul auch die Abfrageschlüssel, und
// ein blanker Mock nimmt die mit.
vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListAdminInbox: () => ({ data: inbox, isPending: false }),
  useReadAdminInboxConversation: () => ({ data: conversation }),
  useReplyInAdminInbox: () => ({ mutateAsync: sendReply, isPending: false }),
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

/** Aufgeklappt: Der Verlauf erscheint erst auf einen Klick. */
async function opened() {
  const wrapper = inboxView()
  await flushPromises()

  const row = wrapper.findAll('button').find((button) => button.text().includes(OPEN.excerpt))
  await row?.trigger('click')
  await flushPromises()

  return wrapper
}

describe('AdminInboxView', () => {
  it('nennt offen, was noch keine Antwort hat — und nur das', async () => {
    const wrapper = inboxView()
    await flushPromises()

    const rows = wrapper.findAll('li')
    expect(rows).toHaveLength(2)

    // Die Aussage hängt an der Zeile, nicht an der Seite: Sonst arbeitet man den falschen Stapel ab.
    expect(rows[0]?.text()).toContain('offen')
    expect(rows[1]?.text()).not.toContain('offen')
  })

  it('nennt in jeder Zeile, unter welchem Namen der Faden läuft', async () => {
    const wrapper = inboxView()
    await flushPromises()

    const rows = wrapper.findAll('li')

    // Dasselbe Mitglied, zwei Fäden: Ohne den Absender stünde es zweimal gleich aussehend da.
    expect(rows[0]?.text()).toContain('Admin')
    expect(rows[1]?.text()).toContain('Weihnachtsmann')
  })

  it('zeigt den Verlauf erst, wenn man ihn aufschlägt', async () => {
    const wrapper = inboxView()
    await flushPromises()

    expect(wrapper.findAllComponents({ name: 'TeamConversation' })).toHaveLength(0)
    expect((await opened()).findAllComponents({ name: 'TeamConversation' })).toHaveLength(1)
  })

  it('sagt vor dem Absenden, unter welchem Namen die Antwort rausgeht', async () => {
    const wrapper = await opened()

    // Ohne den Satz merkt man erst hinterher, dass man nicht unter seinem eigenen Namen
    // geschrieben hat — und dann ist es draußen.
    expect(wrapper.text()).toContain('Geht raus als Admin')
  })

  it('leert das Feld, nachdem die Antwort angekommen ist', async () => {
    sendReply.mockResolvedValue({ status: 201, data: { id: 'm1' } })

    const wrapper = await opened()
    const field = wrapper.find('textarea')
    expect(field.exists()).toBe(true)

    await field.setValue('Gern — hier ist die Antwort.')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(sendReply).toHaveBeenCalled()
    expect((field.element as HTMLTextAreaElement).value).toBe('')
  })

  it('behält den Text, wenn das Absenden fehlschlägt', async () => {
    sendReply.mockRejectedValue(new Error('kaputt'))

    const wrapper = await opened()
    const field = wrapper.find('textarea')

    await field.setValue('Gern — hier ist die Antwort.')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect((field.element as HTMLTextAreaElement).value).toBe('Gern — hier ist die Antwort.')
  })
})
