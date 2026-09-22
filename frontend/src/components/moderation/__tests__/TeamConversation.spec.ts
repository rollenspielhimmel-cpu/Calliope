import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TeamConversation from '@/components/moderation/TeamConversation.vue'

/**
 * Ein Verlauf, wie das Team ihn liest — hier nur, was zum Zurückziehen gehört.
 *
 * Der Text sagt schon, dass sie zurückgezogen ist. **Wer und wann** steht nur hier, beim Team: Das
 * Mitglied sieht es nicht, und genau das ist die Auskunft, die nach dem Zurückziehen bleibt.
 */
function message(overrides: Record<string, unknown>) {
  return {
    id: '01900000-0000-7000-8000-000000000d01',
    text: 'Diese Rundmail wurde zurückgezogen.',
    createdAt: '2026-09-22T08:00:00.000Z',
    username: 'Admin',
    fromTeam: true,
    isAnnouncement: true,
    subject: null,
    writtenByUsername: null,
    retractedByUsername: null,
    retractedAt: null,
    ...overrides,
  }
}

describe('TeamConversation', () => {
  it('nennt an einer zurückgezogenen Rundmail, wer sie zurückgezogen hat', () => {
    const wrapper = mount(TeamConversation, {
      props: {
        messages: [
          message({ retractedByUsername: 'Admin', retractedAt: '2026-09-22T09:14:00.000Z' }),
        ],
      },
    })

    expect(wrapper.text()).toContain('Zurückgezogen von Admin')
  })

  it('sagt nichts dergleichen an einer, die nicht zurückgezogen ist', () => {
    const wrapper = mount(TeamConversation, {
      props: { messages: [message({ text: 'Wartung am Sonntag.' })] },
    })

    expect(wrapper.text()).not.toContain('Zurückgezogen')
  })
})
