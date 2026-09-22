import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import AdminInboxView from '@/views/moderation/AdminInboxView.vue'

/**
 * Das Postfach der Administration.
 *
 * **Was ohne Test still kaputtgeht.** „Offen" steht an der richtigen Zeile, sonst arbeitet man den
 * falschen Stapel ab — und was ohne Antwort erledigt wurde, steht unter „Erledigt", mit wem. Der
 * Absender gehört in die Zeile, weil dasselbe Mitglied hier zweimal stehen kann. Das Antwortfeld
 * darf den Text erst nach dem Erfolg vergessen. Und Ordner nehmen ganze Gespräche wie einzelne
 * Nachrichten auf, ohne dass das eine das andere wird.
 */

const FOLDER_ID = '01900000-0000-7000-8000-0000000000f1'

const OPEN = {
  chatGroupId: '01900000-0000-7000-8000-000000000001',
  username: 'federkiel',
  senderUsername: 'Admin',
  excerpt: 'Ich hätte da eine Frage.',
  lastMessageAt: '2026-09-06T10:00:00.000Z',
  awaitingReply: true,
  isOpen: true,
  markedDoneByUsername: null,
  markedDoneAt: null,
}

const ANSWERED = {
  chatGroupId: '01900000-0000-7000-8000-000000000002',
  username: 'federkiel',
  senderUsername: 'Weihnachtsmann',
  excerpt: 'Alles klar, dann bis morgen.',
  lastMessageAt: '2026-09-05T10:00:00.000Z',
  awaitingReply: false,
  isOpen: false,
  markedDoneByUsername: null,
  markedDoneAt: null,
}

/** Ein „Danke", erledigt ohne Antwort: die letzte Nachricht vom Mitglied, zu tun nichts. */
const THANKED = {
  chatGroupId: '01900000-0000-7000-8000-000000000003',
  username: 'tintenfass',
  senderUsername: 'Admin',
  excerpt: 'Danke euch.',
  lastMessageAt: '2026-09-04T10:00:00.000Z',
  awaitingReply: true,
  isOpen: false,
  markedDoneByUsername: 'rabe',
  markedDoneAt: '2026-09-04T11:00:00.000Z',
}

const MEMBER_MESSAGE_ID = '01900000-0000-7000-8000-00000000000b'

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
      retractedByUsername: null,
      retractedAt: null,
    },
    {
      id: MEMBER_MESSAGE_ID,
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
      retractedByUsername: null,
      retractedAt: null,
    },
  ],
  folderPlaces: { conversation: [], messages: [] },
}

const FOLDER = { id: FOLDER_ID, title: 'Wichtig', conversationCount: 1, messageCount: 2 }

const FOLDER_ITEMS = [
  {
    id: '01900000-0000-7000-8000-0000000000c1',
    kind: 'message',
    chatGroupId: OPEN.chatGroupId,
    username: OPEN.username,
    senderUsername: OPEN.senderUsername,
    addedByUsername: 'rabe',
    addedAt: '2026-09-06T12:00:00.000Z',
    message: {
      id: MEMBER_MESSAGE_ID,
      text: 'Die wichtige Stelle aus dem langen Hin und Her.',
      createdAt: '2026-09-06T10:00:00.000Z',
      authorUsername: OPEN.username,
      fromTeam: false,
    },
  },
]

const mocks = vi.hoisted(() => ({
  inbox: { value: { status: 200, data: { results: [] as unknown[] } } },
  conversation: { value: { status: 200, data: {} as unknown } },
  folders: { value: { status: 200, data: [] as unknown[] } },
  items: { value: { status: 200, data: [] as unknown[] } },
  sendReply: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  markDone: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  reopen: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  addToFolder: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  removeFromFolder: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  reorder: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  pending: <T>(mutateAsync: T) => ({ mutateAsync, isPending: false }),
}))

// Der Rahmen der Moderationsseiten fragt, ob der Rücklink zur Übersicht gezeigt wird.
vi.mock('@/api/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetCurrentUser: () => ({
    data: { value: { status: 200, data: { platformRole: 'administrator' } } },
  }),
}))

// Aufgefaltet statt ersetzt: Die Dateien lesen aus demselben Modul auch die Abfrageschlüssel, und
// ein blanker Mock nimmt die mit.
vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListAdminInbox: () => ({ data: mocks.inbox, isPending: false }),
  useReadAdminInboxConversation: () => ({ data: mocks.conversation }),
  useListAdminInboxFolders: () => ({ data: mocks.folders }),
  useListAdminInboxFolderItems: () => ({ data: mocks.items }),
  useReplyInAdminInbox: () => mocks.pending(mocks.sendReply),
  useMarkAdminInboxConversationDone: () => mocks.pending(mocks.markDone),
  useReopenAdminInboxConversation: () => mocks.pending(mocks.reopen),
  useAddToAdminInboxFolder: () => mocks.pending(mocks.addToFolder),
  useRemoveFromAdminInboxFolder: () => mocks.pending(mocks.removeFromFolder),
  useReorderAdminInboxFolders: () => mocks.pending(mocks.reorder),
  useCreateAdminInboxFolder: () => mocks.pending(vi.fn()),
  useRenameAdminInboxFolder: () => mocks.pending(vi.fn()),
  useDeleteAdminInboxFolder: () => mocks.pending(vi.fn()),
}))

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  mocks.inbox.value = { status: 200, data: { results: [OPEN, ANSWERED, THANKED] } }
  mocks.conversation.value = { status: 200, data: CONVERSATION }
  mocks.folders.value = { status: 200, data: [FOLDER] }
  mocks.items.value = { status: 200, data: FOLDER_ITEMS }
  for (const action of [
    mocks.markDone,
    mocks.reopen,
    mocks.addToFolder,
    mocks.removeFromFolder,
    mocks.reorder,
  ]) {
    action.mockResolvedValue({ status: 200, data: { ok: true } })
  }
})

function inboxView() {
  return mount(AdminInboxView, {
    attachTo: document.body,
    global: {
      stubs: {
        RouterLink: RouterLinkStub,
        // Der Rahmen der Moderationsseiten hängt an vue-query; hier geht es um die Liste darin.
        AppLayout: { template: '<div><slot /></div>' },
      },
    },
  })
}

type View = ReturnType<typeof inboxView>

const button = (wrapper: View, text: string) =>
  wrapper.findAll('button').find((one) => one.text().trim() === text)

async function show(wrapper: View, tab: string) {
  await button(wrapper, tab)?.trigger('click')
  await flushPromises()
}

/** Aufgeklappt: Der Verlauf erscheint erst auf einen Klick. */
async function opened(excerpt: string = OPEN.excerpt, tab?: string) {
  const wrapper = inboxView()
  await flushPromises()
  if (tab !== undefined) {
    await show(wrapper, tab)
  }

  const row = wrapper.findAll('button').find((one) => one.text().includes(excerpt))
  await row?.trigger('click')
  await flushPromises()

  return wrapper
}

describe('AdminInboxView, offen und erledigt', () => {
  it('zeigt unter „Offen“ nur, was noch jemand bearbeiten muss', async () => {
    const wrapper = inboxView()
    await flushPromises()

    const rows = wrapper.findAll('li')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text()).toContain(OPEN.excerpt)
    expect(rows[0]?.text()).toContain('offen')
  })

  it('zeigt unter „Erledigt“ das Beantwortete und das ohne Antwort Erledigte, mit wem', async () => {
    const wrapper = inboxView()
    await flushPromises()
    await show(wrapper, 'Erledigt')

    const rows = wrapper.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('beantwortet')
    expect(rows[1]?.text()).toContain('erledigt von rabe')
    expect(wrapper.text()).not.toContain(OPEN.excerpt)
  })

  it('nennt in jeder Zeile, unter welchem Namen der Faden läuft', async () => {
    const wrapper = inboxView()
    await flushPromises()
    expect(wrapper.findAll('li')[0]?.text()).toContain('Admin')

    await show(wrapper, 'Erledigt')
    // Dasselbe Mitglied, zwei Fäden: Ohne den Absender stünde es zweimal gleich aussehend da.
    expect(wrapper.findAll('li')[0]?.text()).toContain('Weihnachtsmann')
  })

  it('nennt ein offenes Gespräch auf Knopfdruck erledigt', async () => {
    const wrapper = await opened()

    // Der Reiter „Erledigt" oben und der Knopf am Gespräch heißen gleich; gemeint ist der am
    // Gespräch, und der steht in der aufgeklappten Zeile.
    const row = wrapper.findAll('li')[0]
    const doneButton = row?.findAll('button').find((one) => one.text().trim() === 'Erledigt')
    expect(doneButton).toBeDefined()
    await doneButton?.trigger('click')
    await flushPromises()

    expect(mocks.markDone).toHaveBeenCalledWith({ chatGroupId: OPEN.chatGroupId })
  })

  it('nimmt „erledigt“ zurück, wenn es zu früh war', async () => {
    const wrapper = await opened(THANKED.excerpt, 'Erledigt')

    expect(wrapper.text()).toContain('Erledigt von rabe')
    await button(wrapper, 'Wieder öffnen')?.trigger('click')
    await flushPromises()

    expect(mocks.reopen).toHaveBeenCalledWith({ chatGroupId: THANKED.chatGroupId })
  })

  it('zeigt den Verlauf erst, wenn man ihn aufschlägt', async () => {
    const wrapper = inboxView()
    await flushPromises()

    expect(wrapper.findAllComponents({ name: 'TeamConversation' })).toHaveLength(0)
    expect((await opened()).findAllComponents({ name: 'TeamConversation' })).toHaveLength(1)
  })
})

describe('AdminInboxView, antworten', () => {
  it('sagt vor dem Absenden, unter welchem Namen die Antwort rausgeht', async () => {
    const wrapper = await opened()

    // Ohne den Satz merkt man erst hinterher, dass man nicht unter seinem eigenen Namen
    // geschrieben hat — und dann ist es draußen.
    expect(wrapper.text()).toContain('Geht raus als Admin')
  })

  it('leert das Feld, nachdem die Antwort angekommen ist', async () => {
    mocks.sendReply.mockResolvedValue({ status: 201, data: { id: 'm1' } })

    const wrapper = await opened()
    const field = wrapper.find('textarea')
    expect(field.exists()).toBe(true)

    await field.setValue('Gern — hier ist die Antwort.')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.sendReply).toHaveBeenCalled()
    expect((field.element as HTMLTextAreaElement).value).toBe('')
  })

  it('behält den Text, wenn das Absenden fehlschlägt', async () => {
    mocks.sendReply.mockRejectedValue(new Error('kaputt'))

    const wrapper = await opened()
    const field = wrapper.find('textarea')

    await field.setValue('Gern — hier ist die Antwort.')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect((field.element as HTMLTextAreaElement).value).toBe('Gern — hier ist die Antwort.')
  })
})

describe('AdminInboxView, Ordner', () => {
  it('legt das ganze Gespräch in einen Ordner', async () => {
    const wrapper = await opened()

    await wrapper.find('select[aria-label="Gespräch in einen Ordner legen"]').setValue(FOLDER_ID)
    await flushPromises()

    expect(mocks.addToFolder).toHaveBeenCalledWith({
      folderId: FOLDER_ID,
      data: { chatGroupId: OPEN.chatGroupId },
    })
  })

  it('legt eine einzelne Nachricht in einen Ordner, nicht das Gespräch', async () => {
    const wrapper = await opened()

    const pickers = wrapper.findAll('select[aria-label="Nachricht in einen Ordner legen"]')
    // Eine Auswahl je Nachricht im Verlauf.
    expect(pickers).toHaveLength(CONVERSATION.messages.length)

    await pickers[1]?.setValue(FOLDER_ID)
    await flushPromises()

    expect(mocks.addToFolder).toHaveBeenCalledWith({
      folderId: FOLDER_ID,
      data: { chatMessageId: MEMBER_MESSAGE_ID },
    })
  })

  it('zeigt, was im Ordner liegt, und nimmt es wieder heraus', async () => {
    const wrapper = inboxView()
    await flushPromises()
    await show(wrapper, 'Wichtig')

    expect(wrapper.text()).toContain('Die wichtige Stelle aus dem langen Hin und Her.')
    expect(wrapper.text()).toContain('eine Nachricht')
    expect(wrapper.text()).toContain('Eingelegt von rabe')

    await button(wrapper, 'Aus dem Ordner nehmen')?.trigger('click')
    await flushPromises()

    expect(mocks.removeFromFolder).toHaveBeenCalledWith({ itemId: FOLDER_ITEMS[0]?.id })
  })

  it('verschiebt Ordner für alle mit der ganzen Reihenfolge', async () => {
    const second = { ...FOLDER, id: '01900000-0000-7000-8000-0000000000f2', title: 'Bewerbungen' }
    mocks.folders.value = { status: 200, data: [FOLDER, second] }

    const wrapper = inboxView()
    await flushPromises()
    await show(wrapper, 'Ordner verwalten')

    await wrapper.find('button[aria-label="„Bewerbungen“ nach oben"]').trigger('click')
    await flushPromises()

    expect(mocks.reorder).toHaveBeenCalledWith({ data: { folderIds: [second.id, FOLDER_ID] } })
  })

  it('sagt vor dem Löschen, was darin liegt, und dass es im Postfach bleibt', async () => {
    const wrapper = inboxView()
    await flushPromises()
    await show(wrapper, 'Ordner verwalten')

    await button(wrapper, 'Löschen')?.trigger('click')
    await flushPromises()

    const dialog = document.body.textContent ?? ''
    expect(dialog).toContain('„Wichtig“ löschen?')
    expect(dialog).toContain('Darin liegen 1 Gespräch und 2 Nachrichten.')
    expect(dialog).toContain('bleiben im Postfach')
  })
})
