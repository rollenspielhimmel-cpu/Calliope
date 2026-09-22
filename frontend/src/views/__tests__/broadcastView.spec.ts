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

/** Alle drei Rollen — das ist „an alle Mitglieder". */
const EVERYONE = ['administrator', 'moderator', 'member']

const NAMES_ONLY = entry({
  memberIds: ['01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-00000000000b'],
  namedRecipients: [
    { id: '01900000-0000-7000-8000-00000000000a', username: 'eulenfeder' },
    { id: '01900000-0000-7000-8000-00000000000b', username: 'tintenfass' },
  ],
})

const queue = { value: { status: 200, data: [NAMES_ONLY] } }

// Gehoben, weil `vi.mock` vor allem anderen läuft und die Attrappe sonst noch nicht gäbe.
const { sendTest } = vi.hoisted(() => ({
  sendTest: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}))

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
  useSendTestBroadcast: () => ({ mutateAsync: sendTest, isPending: false }),
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
  // Mit Anfang statt ganzem Text: Liegt etwas darin, heißt der Reiter „Warteschlange (1)".
  const tab = wrapper.findAll('button').find((button) => button.text().startsWith('Warteschlange'))
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

/** Holt eine Rundmail aus der Warteschlange ins Formular — der Weg, auf dem es sie wirklich gibt. */
async function editing(broadcast: ReturnType<typeof entry>) {
  queue.value.data = [broadcast]
  const wrapper = broadcastView()
  await openQueue(wrapper)

  const edit = wrapper.findAll('button').find((button) => button.text() === 'Bearbeiten')
  if (edit === undefined) {
    throw new Error('kein „Bearbeiten" an der wartenden Rundmail')
  }
  await edit.trigger('click')
  await flushPromises()

  return wrapper
}

/**
 * Der Satz über das Forum.
 *
 * **Er stand immer da und war doppelt falsch.** Bei einer Rundmail an Namen kommt sie gar nicht ins
 * Forum, und „darf beantwortet werden" stimmte nie — der Archiv-Faden steht für Mitglieder auf
 * `read`, und der Backend-Test dazu bekommt beim Versuch 403.
 */
describe('BroadcastView, der Satz über das Forum', () => {
  const FORUM = 'Im Forum steht sie zum Nachlesen'

  it('fehlt bei einer Rundmail an Namen, und statt seiner steht, warum', async () => {
    const wrapper = await editing(NAMES_ONLY)

    expect(wrapper.text()).not.toContain(FORUM)
    expect(wrapper.text()).toContain('kommt deshalb nicht ins Archiv')
  })

  it('steht da, wenn sie ins Forum geht', async () => {
    const wrapper = await editing(entry({ audienceRoles: EVERYONE, publishInArchive: true }))

    expect(wrapper.text()).toContain(FORUM)
    // Geantwortet wird im Postfach. Der alte Satz versprach das Gegenteil.
    expect(wrapper.text()).toContain('Antworten gehen ins Postfach')
    expect(wrapper.text()).not.toContain('beantwortet werden')
  })

  it('fehlt, wenn der Haken nicht gesetzt ist', async () => {
    // Auch dort stimmt er nicht: Ohne Haken kommt sie nicht ins Forum.
    const wrapper = await editing(entry({ audienceRoles: EVERYONE, publishInArchive: false }))

    expect(wrapper.text()).not.toContain(FORUM)
  })
})

/** Der Haken an der Zeile, die `text` trägt — so, wie jemand ihn sieht und klickt. */
function checkbox(wrapper: ReturnType<typeof broadcastView>, text: string) {
  const label = wrapper.findAll('label').find((each) => each.text().trim() === text)
  if (label === undefined) {
    throw new Error(`keine Zeile „${text}"`)
  }
  return label.find('[role="checkbox"]')
}

function hasLabel(wrapper: ReturnType<typeof broadcastView>, text: string): boolean {
  return wrapper.findAll('label').some((each) => each.text().trim() === text)
}

/**
 * Ins Archiv kommt nur eine Rundmail an alle Mitglieder.
 *
 * **Der Haken war auch bei einer Rundmail allein an die Moderation anklickbar** — und dann stand eine
 * Notiz ans Team für alle im Forum. Auf der Beta ist genau das einmal passiert. Server und Datenbank
 * weisen es inzwischen ab; hier geht es darum, dass das Formular es gar nicht erst anbietet.
 */
describe('BroadcastView, an alle und das Archiv', () => {
  it('bietet das Archiv bei einer einzelnen Rolle nicht an und sagt warum', async () => {
    const wrapper = broadcastView()

    await checkbox(wrapper, 'Moderation').trigger('click')
    await flushPromises()

    expect(hasLabel(wrapper, 'Auch im Forum ablegen')).toBe(false)
    expect(wrapper.text()).toContain('Nur Rundmails an alle Mitglieder kommen ins Archiv.')
  })

  it('„An alle Mitglieder" blendet Rollen und Namen aus und setzt den Archiv-Haken', async () => {
    const wrapper = broadcastView()

    await checkbox(wrapper, 'An alle Mitglieder').trigger('click')
    await flushPromises()

    // Ausschließlich: Dazunehmen lässt sich nichts, es sind ohnehin alle dabei.
    expect(hasLabel(wrapper, 'Moderation')).toBe(false)
    expect(wrapper.findComponent({ name: 'UserPicker' }).exists()).toBe(false)

    // Nur hier erscheint der Haken, und zwar gesetzt.
    expect(checkbox(wrapper, 'Auch im Forum ablegen').attributes('data-state')).toBe('checked')
  })

  it('springt auf „An alle Mitglieder" um, wenn alle drei Rollen einzeln angehakt sind', async () => {
    const wrapper = broadcastView()

    for (const role of ['Administration', 'Moderation', 'Mitglieder ohne Rolle']) {
      // eslint-disable-next-line no-await-in-loop -- ein Klick nach dem anderen, wie ein Mensch
      await checkbox(wrapper, role).trigger('click')
      // eslint-disable-next-line no-await-in-loop
      await flushPromises()
    }

    // Ein Weg zu „alle", nicht zwei, die sich verschieden verhalten.
    expect(checkbox(wrapper, 'An alle Mitglieder').attributes('data-state')).toBe('checked')
    expect(hasLabel(wrapper, 'Moderation')).toBe(false)
    expect(checkbox(wrapper, 'Auch im Forum ablegen').attributes('data-state')).toBe('checked')
  })

  it('fängt beim Abwählen von vorn an und nimmt das Archiv mit', async () => {
    const wrapper = broadcastView()

    await checkbox(wrapper, 'An alle Mitglieder').trigger('click')
    await flushPromises()
    await checkbox(wrapper, 'An alle Mitglieder').trigger('click')
    await flushPromises()

    // Blieben die drei Rollen stehen, stünde sofort wieder „an alle" da.
    expect(checkbox(wrapper, 'Moderation').attributes('data-state')).toBe('unchecked')
    expect(hasLabel(wrapper, 'Auch im Forum ablegen')).toBe(false)
  })

  it('nennt eine Rundmail an alle in der Warteschlange auch so', async () => {
    queue.value.data = [entry({ audienceRoles: EVERYONE, publishInArchive: true })]
    const wrapper = broadcastView()
    await openQueue(wrapper)

    expect(wrapper.text()).toContain('An alle Mitglieder')
  })
})

/** Alle Knöpfe mit diesem Text — so, wie jemand sie sieht. */
function buttonsLabelled(wrapper: ReturnType<typeof broadcastView>, text: string) {
  const found = wrapper.findAll('button').filter((each) => each.text() === text)
  if (found.length === 0) {
    throw new Error(`kein Knopf „${text}"`)
  }
  return found
}

/**
 * Die Test-Rundmail, an beiden Knöpfen.
 *
 * **Was die Oberfläche hier zusagt:** Die Anfrage nennt keinen Empfänger, und der Satz danach sagt,
 * dass sie sonst niemand bekommen hat — am Knopf, der sie ausgelöst hat, und nirgends sonst. Ein
 * gemeinsamer Satz oben auf der Seite ließe offen, welcher Eintrag gemeint war.
 */
describe('BroadcastView, die Test-Rundmail', () => {
  const SAID = 'Die Test-Rundmail liegt in deinem Postfach.'

  it('geht aus dem Formular ohne Empfänger an den Server', async () => {
    sendTest.mockReset()
    sendTest.mockResolvedValue({
      status: 200,
      data: { chatGroupId: '01900000-0000-7000-8000-000000000009', email: 'not_chosen' },
    })
    queue.value.data = []
    const wrapper = broadcastView()

    const [test] = buttonsLabelled(wrapper, 'Test-Rundmail')
    // Ohne Betreff und Text gibt es nichts zu testen.
    expect(test?.attributes('disabled')).toBeDefined()

    await wrapper.find('#broadcastSubject').setValue('Ein Betreff')
    await wrapper.find('#broadcastBody').setValue('Ein Text.')
    await buttonsLabelled(wrapper, 'Test-Rundmail')[0]?.trigger('click')
    await flushPromises()

    // **Kein Empfängerkreis in der Anfrage.** Der Server nimmt die angemeldete Person; was hier
    // nicht mitgeht, kann auch nichts anderes behaupten.
    expect(sendTest).toHaveBeenCalledWith({
      data: {
        subject: 'Ein Betreff',
        body: 'Ein Text.',
        sendAsUserId: null,
        deliverByEmail: false,
      },
    })
    expect(wrapper.text()).toContain(SAID)
  })

  it('schickt aus der Warteschlange den gespeicherten Stand und antwortet am Eintrag', async () => {
    sendTest.mockReset()
    sendTest.mockResolvedValue({
      status: 200,
      data: { chatGroupId: '01900000-0000-7000-8000-000000000009', email: 'sent' },
    })
    queue.value.data = [NAMES_ONLY]
    const wrapper = broadcastView()
    await openQueue(wrapper)

    await buttonsLabelled(wrapper, 'Test-Rundmail')[0]?.trigger('click')
    await flushPromises()

    // Wer freigibt, soll sehen, was eingereicht wurde — nicht, was gerade im Formular steht.
    expect(sendTest).toHaveBeenCalledWith({
      data: {
        subject: 'Zu zweit',
        body: 'Nur für euch beide.',
        sendAsUserId: null,
        deliverByEmail: false,
      },
    })

    const item = wrapper.findAll('li').find((each) => each.text().includes('Zu zweit'))
    expect(item?.text()).toContain('eine Test-Mail ist an deine Adresse unterwegs')
  })
})

/** Der Reiter der Warteschlange, mit oder ohne Zahl. */
function queueTab(wrapper: ReturnType<typeof broadcastView>) {
  return wrapper.findAll('button').find((each) => each.text().startsWith('Warteschlange'))
}

/**
 * Die Zahl am Reiter der Warteschlange.
 *
 * **Nur was auf eine Freigabe wartet.** Das Geplante ist freigegeben und wartet bloß auf die Uhr —
 * da ist niemand am Zug, und eine Zahl dafür risse jemanden zu einem Reiter, an dem nichts zu tun
 * ist.
 */
describe('BroadcastView, die Zahl an der Warteschlange', () => {
  it('zählt, was wartet, und nicht das Geplante', () => {
    queue.value.data = [
      entry({ publicationId: '01900000-0000-7000-8000-0000000000a1' }),
      entry({
        publicationId: '01900000-0000-7000-8000-0000000000a2',
        status: 'approved',
        scheduledFor: '2030-01-01T10:00:00.000Z',
      }),
    ]

    expect(queueTab(broadcastView())?.text()).toBe('Warteschlange (1)')
  })

  it('zeigt keine Null', () => {
    // Nur Geplantes: Niemand ist am Zug, also steht der Reiter ohne Zahl da.
    queue.value.data = [entry({ status: 'approved', scheduledFor: '2030-01-01T10:00:00.000Z' })]

    expect(queueTab(broadcastView())?.text()).toBe('Warteschlange')
  })
})
