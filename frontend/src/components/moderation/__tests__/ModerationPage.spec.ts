import { describe, expect, it, vi } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import ModerationPage from '@/components/moderation/ModerationPage.vue'

/**
 * Der Rücklink zur Übersicht der Moderation: nur für das Team. Wer ohne Teamrolle mit einem
 * persönlichen Absender auf der Rundmail-Seite ist, würde von dort nach Hause umgeleitet.
 */

const { viewer } = vi.hoisted(() => ({ viewer: { platformRole: null as string | null } }))

vi.mock('@/api/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetCurrentUser: () => ({
    data: { value: { status: 200, data: { platformRole: viewer.platformRole } } },
  }),
}))

function page(platformRole: string | null) {
  viewer.platformRole = platformRole
  return mount(ModerationPage, {
    props: { title: 'Rundmail', description: 'Eine Nachricht.' },
    global: {
      stubs: { RouterLink: RouterLinkStub, AppLayout: { template: '<div><slot /></div>' } },
    },
  })
}

describe('ModerationPage', () => {
  it('führt das Team zurück in die Moderation', () => {
    expect(page('moderator').findAllComponents(RouterLinkStub)).toHaveLength(1)
  })

  it('bietet ohne Teamrolle keinen Weg in die Moderation an', () => {
    expect(page(null).findAllComponents(RouterLinkStub)).toHaveLength(0)
  })
})
