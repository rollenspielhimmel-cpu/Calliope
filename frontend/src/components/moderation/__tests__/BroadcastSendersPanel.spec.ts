import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import BroadcastSendersPanel from '@/components/moderation/BroadcastSendersPanel.vue'

/**
 * Wer welchen Absender nutzen darf, in der Absender-Tafel: je Absender „Nutzbar für die
 * Moderation" und die Personen, die ihn persönlich haben, und darunter die Übersicht andersherum.
 * Lesen dürfen es alle Administrationen, ändern nur der Ur-Admin; wer keine Administration hat,
 * sieht nur seine Absender.
 */

const ADMIN_ACCOUNT = '01900000-0000-7000-8000-0000000000a1'
const FLAMINGO = '01900000-0000-7000-8000-0000000000a2'
const ROGUE = '01900000-0000-7000-8000-0000000000a3'

const { viewer, grantToRole, revokeFromRole } = vi.hoisted(() => ({
  viewer: { platformRole: 'administrator' as string | null, isPrimordialAdmin: false },
  grantToRole: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  revokeFromRole: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}))

vi.mock('@/api/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetCurrentUser: () => ({
    data: {
      value: {
        status: 200,
        data: { platformRole: viewer.platformRole, isPrimordialAdmin: viewer.isPrimordialAdmin },
      },
    },
  }),
}))

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListBroadcastSenders: () => ({
    data: {
      value: {
        status: 200,
        data: [
          { id: ADMIN_ACCOUNT, username: 'Admin', isPermanent: true },
          { id: FLAMINGO, username: 'Infoflamingo', isPermanent: false },
        ],
      },
    },
    isPending: false,
  }),
  useListSenderGrants: () => ({
    data: {
      value: {
        status: 200,
        data: [
          {
            senderId: ADMIN_ACCOUNT,
            role: 'moderator',
            userId: null,
            username: null,
            grantedAt: '2026-09-22T10:00:00.000Z',
          },
          {
            senderId: FLAMINGO,
            role: null,
            userId: ROGUE,
            username: 'Rogue',
            grantedAt: '2026-09-22T10:00:00.000Z',
          },
        ],
      },
    },
  }),
  useReleaseBroadcastSender: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
  useWithdrawBroadcastSender: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
  useGrantSenderToRole: () => ({ mutateAsync: grantToRole }),
  useRevokeSenderFromRole: () => ({ mutateAsync: revokeFromRole }),
  useGrantSenderToPerson: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  }),
  useRevokeSenderFromPerson: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  }),
}))

function panel(platformRole: string | null, isPrimordialAdmin = false) {
  viewer.platformRole = platformRole
  viewer.isPrimordialAdmin = isPrimordialAdmin
  return mount(BroadcastSendersPanel, {
    global: { stubs: { RouterLink: RouterLinkStub, UserPicker: true } },
  })
}

function moderatorBoxes(wrapper: ReturnType<typeof panel>) {
  return wrapper.findAll('[role="checkbox"]')
}

describe('BroadcastSendersPanel', () => {
  it('zeigt der Administration, für wen jeder Absender gilt', () => {
    const wrapper = panel('administrator')

    const [admin, flamingo] = moderatorBoxes(wrapper)
    expect(admin?.attributes('data-state')).toBe('checked')
    expect(flamingo?.attributes('data-state')).toBe('unchecked')
    expect(wrapper.text()).toContain('Persönlich: Rogue')
  })

  it('nennt in der Übersicht, wer welchen Absender persönlich hat', () => {
    const text = panel('administrator').text()

    expect(text).toContain('Persönliche Freigaben')
    expect(text).toContain('Rogue')
    expect(text).toContain('als Infoflamingo')
  })

  it('sperrt die Häkchen für jede Administration außer dem Ur-Admin', () => {
    const wrapper = panel('administrator', false)

    // Erst zählen: Ohne Häkchen liefe die Schleife leer und bewiese nichts.
    expect(moderatorBoxes(wrapper)).toHaveLength(2)
    for (const box of moderatorBoxes(wrapper)) {
      expect(box.attributes('disabled')).toBeDefined()
    }
  })

  it('lässt den Ur-Admin einen Absender der Moderation geben', async () => {
    grantToRole.mockReset()
    grantToRole.mockResolvedValue({ status: 200, data: { ok: true } })
    const wrapper = panel('administrator', true)

    await moderatorBoxes(wrapper)[1]?.trigger('click')
    await flushPromises()

    expect(grantToRole).toHaveBeenCalledWith({ senderId: FLAMINGO, role: 'moderator' })
    expect(revokeFromRole).not.toHaveBeenCalled()
  })

  it('zeigt jemandem ohne Administration weder Freigaben noch Übersicht', () => {
    const wrapper = panel(null)

    expect(moderatorBoxes(wrapper)).toHaveLength(0)
    expect(wrapper.text()).not.toContain('Persönliche Freigaben')
    expect(wrapper.text()).toContain('unter denen du vorbereiten darfst')
  })
})
