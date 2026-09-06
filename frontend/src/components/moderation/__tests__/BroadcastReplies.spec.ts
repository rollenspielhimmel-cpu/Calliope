import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import BroadcastReplies from '@/components/moderation/BroadcastReplies.vue'

/**
 * Das Antwortfeld der Administration.
 *
 * **Warum es hier geprüft wird und nicht nur im Backend:** Dass die Antwort unter dem Absender
 * rausgeht und `written_by` den Menschen festhält, steht dort. Was diese Datei hält, ist die
 * Hälfte, die der Mensch vor dem Bildschirm sieht — dass der Satz dasteht, *bevor* etwas rausgeht,
 * und dass ein Aussetzer der Verbindung das Geschriebene nicht verschluckt.
 *
 * Das Feld leert sich erst nach dem Erfolg. Genau daran ist das Kommentarfeld der Statusmeldungen
 * einmal gescheitert — siehe `StatusFeed.spec.ts`.
 */

const REPLY = {
  chatGroupId: '01900000-0000-7000-8000-000000000001',
  username: 'federkiel',
  lastActivityAt: '2026-09-06T10:00:00.000Z',
  excerpt: 'Danke für die Ankündigung.',
}

const CONVERSATION = {
  chatGroupId: REPLY.chatGroupId,
  username: REPLY.username,
  messages: [
    {
      id: '01900000-0000-7000-8000-00000000000a',
      text: 'Bitte einmal zurückschreiben.',
      createdAt: '2026-09-06T09:00:00.000Z',
      username: 'Admin',
      fromTeam: true,
    },
    {
      id: '01900000-0000-7000-8000-00000000000b',
      text: 'Danke für die Ankündigung.',
      createdAt: '2026-09-06T10:00:00.000Z',
      username: REPLY.username,
      fromTeam: false,
    },
  ],
}

const replies = { value: { status: 200, data: { results: [REPLY] } } }
const conversation = { value: { status: 200, data: CONVERSATION } }

const sendReply = vi.fn<(...args: unknown[]) => Promise<unknown>>()

// Aufgefaltet statt ersetzt: Die Datei liest aus demselben Modul auch die Abfrageschlüssel, und
// ein blanker Mock nimmt die mit.
vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // Schlichte Werte statt `ref`: In der Vorlage wird `isPending` unmittelbar gelesen, und ein
  // Objekt `{ value: false }` ist dort wahr — die Ansicht bliebe für immer im Ladezustand.
  useListBroadcastReplies: () => ({ data: replies, isPending: false }),
  useReadBroadcastConversation: () => ({ data: conversation }),
  useReplyToBroadcast: () => ({
    mutateAsync: sendReply,
    isPending: false,
  }),
}))

/** Der Aufklapper des einen Gesprächs — er trägt den Namen des Mitglieds. */
function conversationToggle(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button').find((button) => button.text().includes(REPLY.username))
}

/** Beide Aufklapper: erst die Antworten, dann das eine Gespräch. */
async function openConversation() {
  const wrapper = mount(BroadcastReplies, {
    props: { broadcastId: '01900000-0000-7000-8000-0000000000ff' },
  })

  await wrapper.findAll('button')[0]?.trigger('click')
  await flushPromises()

  await conversationToggle(wrapper)?.trigger('click')
  await flushPromises()

  return wrapper
}

describe('BroadcastReplies', () => {
  it('sagt vor dem Absenden, unter welchem Namen die Antwort rausgeht', async () => {
    const wrapper = await openConversation()

    // Ohne den Satz merkt man erst hinterher, dass man nicht unter seinem eigenen Namen
    // geschrieben hat — und dann ist es draußen.
    expect(wrapper.text()).toContain('Geht raus unter dem Absender der Rundmail')
  })

  it('leert das Feld, nachdem die Antwort angekommen ist', async () => {
    sendReply.mockResolvedValue({ status: 201, data: { id: 'm1' } })

    const wrapper = await openConversation()
    const field = wrapper.find('textarea')
    expect(field.exists()).toBe(true)

    await field.setValue('Gern — melde dich, wenn noch etwas offen ist.')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(sendReply).toHaveBeenCalled()
    expect((field.element as HTMLTextAreaElement).value).toBe('')
  })

  it('behält den Text, wenn das Absenden fehlschlägt', async () => {
    sendReply.mockRejectedValue(new Error('kaputt'))

    const wrapper = await openConversation()
    const field = wrapper.find('textarea')

    await field.setValue('Gern — melde dich, wenn noch etwas offen ist.')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect((field.element as HTMLTextAreaElement).value).toBe(
      'Gern — melde dich, wenn noch etwas offen ist.',
    )
  })

  it('vergisst einen angefangenen Text beim Wechsel des Gesprächs', async () => {
    const wrapper = await openConversation()

    await wrapper.find('textarea').setValue('Halb getippt.')

    // Zuklappen und wieder auf: Ein Text, der zu einem anderen Gespräch gehört, ginge sonst an
    // jemanden, für den er nie gedacht war.
    await conversationToggle(wrapper)?.trigger('click')
    await flushPromises()
    await conversationToggle(wrapper)?.trigger('click')
    await flushPromises()

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })
})
