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
  createGroupThread: vi.fn<(variables: unknown) => Promise<unknown>>(),
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
  useCreateThread: () => ({ mutateAsync: mocks.createGroupThread, isPending: false }),
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
    asksForFirstPost: boolean
    firstPost: unknown
    firstPostText: string
    form: {
      setFieldValue: (name: string, value: string) => void
      handleSubmit: () => Promise<void>
    }
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
  mocks.createForumThread.mockReset()
  mocks.createForumThread.mockResolvedValue({ status: 201, data: { id: 'thread-1' } })
  mocks.createGroupThread.mockReset()
  mocks.createGroupThread.mockResolvedValue({ status: 201, data: { id: 'thread-1' } })
})

const DOCUMENT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Der erste Beitrag.' }] }],
}

/** Titel eintragen und abschicken, wie der Knopf es tut. */
async function send(view: ReturnType<typeof state>, title = 'Ein Titel') {
  view.form.setFieldValue('title', title)
  await view.form.handleSubmit()
}

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

/**
 * **Ein Thema entsteht mit seinem ersten Beitrag.** Auf der Beta sind leere Themen entstanden: Der
 * Text war erst in der Ansicht dahinter zu schreiben, und beim offiziellen Thread stand das Feld
 * von Anfang an im Dialog. Dieselbe Selbstverständlichkeit gilt jetzt für das gewöhnliche Thema.
 */
describe('ThreadDialog, erster Beitrag', () => {
  it('fragt im Forum nach dem ersten Beitrag, in der Gruppe nicht', () => {
    expect(state(dialog()).asksForFirstPost).toBe(true)
    expect(state(dialog({ kind: 'group', groupId: 'group-1' })).asksForFirstPost).toBe(false)
  })

  it('fragt nicht doppelt, wenn der Thread offiziell wird', () => {
    const view = state(dialog())
    view.official = enabled()
    expect(view.asksForFirstPost).toBe(false)
  })

  it('legt Thema und ersten Beitrag zusammen an', async () => {
    const view = state(dialog())
    view.firstPost = DOCUMENT
    view.firstPostText = 'Der erste Beitrag.'

    await send(view)

    expect(mocks.createForumThread).toHaveBeenCalledWith({
      data: { title: 'Ein Titel', folderId: 'folder-1', document: DOCUMENT },
    })
  })

  it('legt ohne ersten Beitrag gar nichts an', async () => {
    const view = state(dialog())
    view.firstPostText = '   '

    await send(view)

    expect(mocks.createForumThread).not.toHaveBeenCalled()
    expect(view.formError).toContain('ersten Beitrag')
  })

  it('lässt ein Thema in der Gruppe wie bisher ohne Beitrag entstehen', async () => {
    const view = state(dialog({ kind: 'group', groupId: 'group-1' }))

    await send(view)

    expect(mocks.createGroupThread).toHaveBeenCalledWith({
      groupId: 'group-1',
      data: { title: 'Ein Titel', folderId: 'folder-1' },
    })
  })
})
