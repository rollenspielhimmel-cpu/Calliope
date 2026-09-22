import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RolePermissionsPanel from '@/components/moderation/RolePermissionsPanel.vue'

/**
 * Was Rollen dürfen: Jede Administration liest es, nur der Ur-Admin ändert es. Die Administration
 * selbst steht nicht in der Liste — sie darf alles.
 */

const { grant, revoke, listing } = vi.hoisted(() => ({
  grant: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  revoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listing: {
    value: {
      status: 200,
      data: {
        roles: ['moderator'],
        permissions: ['prepare_publications'],
        granted: [
          {
            role: 'moderator',
            permission: 'prepare_publications',
            grantedByUsername: null,
            grantedAt: '2026-09-22T08:00:00.000Z',
          },
        ],
      },
    },
  },
}))

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListRolePermissions: () => ({ data: listing }),
  useGrantRolePermission: () => ({ mutateAsync: grant, isPending: false }),
  useRevokeRolePermission: () => ({ mutateAsync: revoke, isPending: false }),
}))

function panel(mayChange: boolean) {
  return mount(RolePermissionsPanel, { props: { mayChange } })
}

describe('RolePermissionsPanel', () => {
  it('zeigt, dass die Moderation vorbereiten darf, und nennt die Administration nicht', () => {
    const wrapper = panel(false)

    expect(wrapper.text()).toContain('Moderation')
    expect(wrapper.text()).toContain('Offizielle Threads und Rundmails vorbereiten')
    expect(wrapper.find('[role="checkbox"]').attributes('data-state')).toBe('checked')
    // Nur im Satz darüber, nicht als Zeile mit Häkchen.
    expect(wrapper.findAll('[role="checkbox"]')).toHaveLength(1)
  })

  it('sperrt das Häkchen für jede Administration außer dem Ur-Admin', () => {
    const wrapper = panel(false)

    expect(wrapper.find('[role="checkbox"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Ändern kann das allein das erste Konto.')
  })

  it('lässt den Ur-Admin die Berechtigung entziehen', async () => {
    revoke.mockResolvedValueOnce({ status: 200, data: { ok: true } })
    const wrapper = panel(true)

    await wrapper.find('[role="checkbox"]').trigger('click')
    await flushPromises()

    expect(revoke).toHaveBeenCalledWith({ role: 'moderator', permission: 'prepare_publications' })
    expect(grant).not.toHaveBeenCalled()
  })
})
