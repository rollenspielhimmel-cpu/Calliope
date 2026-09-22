import { describe, expect, it, vi } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import OfficialThreadQueue from '@/components/moderation/OfficialThreadQueue.vue'

/**
 * Offizielle Threads in der Warteschlange: Freigeben nur die Administration, bearbeiten und
 * verwerfen sie alles, alle anderen nur das Eigene — dieselben Regeln wie bei Rundmails.
 */

const OWN = '01900000-0000-7000-8000-0000000000e1'
const OTHER = '01900000-0000-7000-8000-0000000000e2'

const mocks = vi.hoisted(() => ({
  viewer: {
    platformRole: 'moderator' as string | null,
    id: '01900000-0000-7000-8000-0000000000e1',
  },
  queue: { value: { status: 200, data: [] as unknown[] } },
}))

vi.mock('@/api/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetCurrentUser: () => ({
    data: {
      value: {
        status: 200,
        data: { platformRole: mocks.viewer.platformRole, id: mocks.viewer.id },
      },
    },
  }),
}))

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListOfficialThreadQueue: () => ({ data: mocks.queue }),
  useListReleasedOfficialThreads: () => ({ data: { value: { status: 200, data: [] } } }),
  useApproveOfficialThread: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
  useDiscardOfficialThread: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
  useEditOfficialThread: () => ({
    mutateAsync: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    isPending: false,
  }),
}))

function entry(publicationId: string, writtenBy: string, title: string) {
  return {
    publicationId,
    threadId: `${publicationId}-thread`,
    status: 'awaiting_approval',
    title,
    text: 'Text',
    folderId: null,
    folderTitle: null,
    sendAsUserId: null,
    sendAsUsername: null,
    scheduledFor: null,
    administrationOnly: false,
    writtenBy,
    writtenByUsername: 'jemand',
    writtenAt: '2026-09-22T10:00:00.000Z',
    approvedByUsername: null,
    approvedAt: null,
    editedByUsername: null,
    editedAt: null,
    releasedAt: null,
  }
}

function queueAs(platformRole: string | null) {
  mocks.viewer.platformRole = platformRole
  mocks.queue.value = {
    status: 200,
    data: [entry('p-own', OWN, 'Mein Thread'), entry('p-other', OTHER, 'Fremder Thread')],
  }
  return mount(OfficialThreadQueue, {
    props: { mode: 'waiting' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

const labelled = (wrapper: ReturnType<typeof queueAs>, text: string) =>
  wrapper.findAll('button').filter((button) => button.text() === text)

describe('OfficialThreadQueue', () => {
  it('bietet einem Mod kein Freigeben an und Ändern nur beim Eigenen', () => {
    const wrapper = queueAs('moderator')

    expect(labelled(wrapper, 'Freigeben und veröffentlichen')).toHaveLength(0)
    expect(labelled(wrapper, 'Bearbeiten')).toHaveLength(1)
    expect(labelled(wrapper, 'Verwerfen')).toHaveLength(1)
  })

  it('bietet der Administration Freigeben und Ändern an beidem an', () => {
    const wrapper = queueAs('administrator')

    expect(labelled(wrapper, 'Freigeben und veröffentlichen')).toHaveLength(2)
    expect(labelled(wrapper, 'Bearbeiten')).toHaveLength(2)
  })
})
