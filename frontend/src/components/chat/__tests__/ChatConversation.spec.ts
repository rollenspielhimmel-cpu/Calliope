import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { VueQueryPlugin } from '@tanstack/vue-query'
import ChatConversation from '@/components/chat/ChatConversation.vue'

/**
 * Ein Gespräch, soweit ein Test-Faden es anders macht.
 *
 * **Im Test-Faden sitzt nur, wer getestet hat.** Ein Eingabefeld sähe aus, als schriebe man dem
 * Absender — die Antwort ginge an niemanden. Einladen hieße, jemandem eine Rundmail zu zeigen, die
 * nie freigegeben wurde. Verlassen darf man ihn dagegen: Er ist ein Werkzeug und soll sich nicht
 * ansammeln. Der Server lehnt Schreiben und Einladen ohnehin ab; hier geht es darum, dass die
 * Oberfläche beides gar nicht erst anbietet.
 */

// Das Gespräch zieht sieben Abfragen heran. Hier zählen nur, wer darin sitzt und dass nichts lädt.
vi.mock('@/api/chats/chats', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListChatMemberships: () => ({
    data: ref({
      status: 200,
      data: {
        results: [
          {
            userId: '01900000-0000-7000-8000-00000000000a',
            username: 'federkiel',
            status: 'joined',
          },
        ],
      },
    }),
  }),
  useCreateMessage: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: ref(false),
  }),
  // Aufgelöst, nicht leer: Das Gespräch hängt an das Gelesen-Melden ein `.catch`.
  useReadChat: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/api/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetCurrentUser: () => ({ data: ref(undefined) }),
}))

// Eine Nachricht, wie der Test-Faden sie trägt: mit Betreff, ohne Rundmail-Kennung.
const { shown } = vi.hoisted(() => ({
  shown: [
    {
      id: '01900000-0000-7000-8000-000000000b01',
      chatGroupId: '01900000-0000-7000-8000-000000000001',
      text: 'So sähe sie aus.',
      createdBy: '01900000-0000-7000-8000-00000000000c',
      createdAt: '2026-09-22T08:00:00.000Z',
      subject: 'Wartung',
      createdByUsername: 'Admin',
      isBroadcast: false,
    },
  ],
}))

vi.mock('@/composables/useChatMessages', () => ({
  useChatMessages: () => ({
    fetched: ref(shown),
    hasLoaded: ref(true),
    isPending: ref(false),
    isError: ref(false),
    hasOlder: ref(false),
    isLoadingOlder: ref(false),
    loadOlder: vi.fn<() => void>(),
    refetch: vi.fn<() => void>(),
  }),
}))

vi.mock('@/composables/useOwnChatMembership', () => ({
  useOwnChatMembership: () => ({
    leave: vi.fn<() => void>(),
    isBusy: ref(false),
    error: ref(undefined),
  }),
}))

vi.mock('@/composables/useFavourite', () => ({
  useFavourite: () => ({
    savingFavourite: ref(false),
    favouriteError: ref(undefined),
    changeFavourite: vi.fn<() => Promise<boolean>>(),
  }),
}))

function conversation(isTestBroadcast: boolean) {
  return mount(ChatConversation, {
    props: {
      chatGroupId: '01900000-0000-7000-8000-000000000001',
      title: 'Admin',
      live: [],
      isFavourite: false,
      isFromAdministration: false,
      isTestBroadcast,
    },
    global: {
      plugins: [VueQueryPlugin],
      stubs: { ChatInvite: { template: '<div data-invite />' } },
    },
  })
}

describe('ChatConversation, ein Test-Faden', () => {
  it('bietet kein Eingabefeld an und sagt warum', async () => {
    const wrapper = conversation(true)
    await flushPromises()

    expect(wrapper.find('input[name="message"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Das ist eine Test-Rundmail, nur für dich.')
  })

  it('bietet kein Einladen an', async () => {
    const wrapper = conversation(true)
    await flushPromises()

    expect(wrapper.find('[data-invite]').exists()).toBe(false)
  })

  it('lässt verlassen', async () => {
    const wrapper = conversation(true)
    await flushPromises()

    expect(wrapper.findAll('button').some((button) => button.text() === 'Verlassen')).toBe(true)
  })

  it('ein gewöhnliches Gespräch bleibt, wie es war', async () => {
    // Die Gegenseite: Sonst bestünde auch eine Ansicht, die nirgends mehr schreiben ließe.
    const wrapper = conversation(false)
    await flushPromises()

    expect(wrapper.find('input[name="message"]').exists()).toBe(true)
    expect(wrapper.find('[data-invite]').exists()).toBe(true)
  })
})

describe('ChatConversation, die Markierung', () => {
  it('steht im Test-Faden vor dem Betreff, und die Nachricht trägt die Kante', async () => {
    const wrapper = conversation(true)
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Test-Rundmail')
    // Das Erste, was man liest: vor dem Betreff, nicht irgendwo darunter.
    expect(text.indexOf('Test-Rundmail')).toBeLessThan(text.indexOf('Wartung'))
    // Sie soll aussehen wie später — also die Kante wie an der echten Rundmail, obwohl die
    // Nachricht keine Rundmail-Kennung trägt.
    expect(wrapper.find('.border-oak').exists()).toBe(true)
  })

  it('fehlt in einem gewöhnlichen Gespräch', async () => {
    const wrapper = conversation(false)
    await flushPromises()

    expect(wrapper.text()).not.toContain('Test-Rundmail')
    expect(wrapper.find('.border-oak').exists()).toBe(false)
  })
})
