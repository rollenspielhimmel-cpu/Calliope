import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ThreadDialog from '@/components/thread/ThreadDialog.vue'
import type { OfficialDraft } from '@/components/thread/OfficialThreadFields.vue'

/**
 * Der Haken „geht online als offizieller RSH-Thread" im Dialog, der ein Forum-Thema anlegt.
 *
 * Angeboten nur im Forum, nur beim Anlegen und nur wem vorbereiten darf. Gesetzt, geht die Anlage
 * an `submitOfficialThread` — mit dem Eröffnungsbeitrag, weil die Freigabe den Text abdecken muss.
 * Was danach geschah, sagt die Antwort, nicht die eigene Rolle.
 */

const mocks = vi.hoisted(() => ({
  viewer: { platformRole: 'moderator' as string | null, mayPreparePublications: true },
  submitOfficial: vi.fn<(variables: unknown) => Promise<unknown>>(),
  createForumThread: vi.fn<(variables: unknown) => Promise<unknown>>(),
}))

vi.mock('@tanstack/vue-query', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useQueryClient: () => ({
    invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/api/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetCurrentUser: () => ({
    data: {
      value: {
        status: 200,
        data: {
          platformRole: mocks.viewer.platformRole,
          mayPreparePublications: mocks.viewer.mayPreparePublications,
        },
      },
    },
  }),
}))

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSubmitOfficialThread: () => ({ mutateAsync: mocks.submitOfficial, isPending: false }),
}))

vi.mock('@/api/forum/forum', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCreateForumThread: () => ({ mutateAsync: mocks.createForumThread, isPending: false }),
}))

vi.mock('@/api/threads/threads', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCreateThread: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
  useUpdateThread: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
}))

type Scope = { kind: 'forum' } | { kind: 'group'; groupId: string }

function dialog(scope: Scope = { kind: 'forum' }) {
  return mount(ThreadDialog, {
    props: { open: true, scope: scope as never, folderId: 'folder-1' },
    shallow: true,
  })
}

function state(wrapper: ReturnType<typeof dialog>) {
  return wrapper.vm as unknown as {
    offersOfficial: boolean
    submitLabel: string
    official: OfficialDraft
    officialOutcome: string | undefined
    formError: string | undefined
    submitOfficial: (title: string) => Promise<void>
  }
}

function enabled(overrides: Partial<OfficialDraft> = {}): OfficialDraft {
  return {
    enabled: true,
    text: 'Der Eröffnungsbeitrag.',
    sendAs: '',
    scheduledFor: '',
    administrationOnly: false,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.viewer.platformRole = 'moderator'
  mocks.viewer.mayPreparePublications = true
  mocks.submitOfficial.mockReset()
})

describe('ThreadDialog, offizieller Thread', () => {
  it('bietet den Haken im Forum an, wer vorbereiten darf', () => {
    expect(state(dialog()).offersOfficial).toBe(true)
  })

  it('bietet ihn nicht an, wer nicht vorbereiten darf', () => {
    mocks.viewer.mayPreparePublications = false
    expect(state(dialog()).offersOfficial).toBe(false)
  })

  it('bietet ihn in einer Schreibgruppe nicht an', () => {
    expect(state(dialog({ kind: 'group', groupId: 'group-1' })).offersOfficial).toBe(false)
  })

  it('nennt den Knopf nach dem, was geschieht', () => {
    const asMod = state(dialog())
    asMod.official = enabled()
    expect(asMod.submitLabel).toBe('Zur Freigabe einreichen')

    mocks.viewer.platformRole = 'administrator'
    const asAdmin = state(dialog())
    asAdmin.official = enabled()
    expect(asAdmin.submitLabel).toBe('Jetzt veröffentlichen')
    asAdmin.official = enabled({ scheduledFor: '2026-10-01T20:00' })
    expect(asAdmin.submitLabel).toBe('Freigeben')
  })

  it('reicht mit Eröffnungsbeitrag und Unterforum ein und sagt, dass er in der Warteschlange steht', async () => {
    mocks.submitOfficial.mockResolvedValue({
      status: 201,
      data: { status: 'awaiting_approval', threadId: 'thread-1', scheduledFor: null },
    })
    const wrapper = dialog()
    const view = state(wrapper)
    view.official = enabled()

    await view.submitOfficial('Ein Titel')

    expect(mocks.submitOfficial).toHaveBeenCalledWith({
      data: {
        title: 'Ein Titel',
        text: 'Der Eröffnungsbeitrag.',
        folderId: 'folder-1',
        sendAsUserId: null,
        scheduledFor: null,
        administrationOnly: false,
      },
    })
    expect(view.officialOutcome).toContain('Warteschlange')
    expect(view.officialOutcome).toContain('sobald die Administration ihn freigibt')
  })

  it('öffnet den Thread, wenn er gleich erschienen ist', async () => {
    mocks.submitOfficial.mockResolvedValue({
      status: 201,
      data: { status: 'released', threadId: 'thread-9', scheduledFor: null },
    })
    const wrapper = dialog()
    const view = state(wrapper)
    view.official = enabled()

    await view.submitOfficial('Ein Titel')

    expect(wrapper.emitted('created')).toEqual([['thread-9']])
  })

  it('reicht ohne Eröffnungsbeitrag nicht ein', async () => {
    const view = state(dialog())
    view.official = enabled({ text: '   ' })

    await view.submitOfficial('Ein Titel')

    expect(mocks.submitOfficial).not.toHaveBeenCalled()
    expect(view.formError).toContain('Eröffnungsbeitrag')
  })
})
