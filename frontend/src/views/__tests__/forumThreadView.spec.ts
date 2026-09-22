import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import ForumThreadView from '@/views/ForumThreadView.vue'

/**
 * Ein Forum-Thema, wie ein Mitglied es sieht.
 *
 * **Der Schreibkasten ist der Zweck der Seite.** Ein Thema entsteht ohne Beitrag: Der erste wird
 * hier geschrieben. Fehlt der Kasten oder wirft die Seite beim Aufbauen, steht ein leeres Thema da,
 * in das niemand etwas schreiben kann — und keine Prüfung dieser Datei ist dann noch grün.
 */

const THREAD_ID = '01900000-0000-7000-8000-000000000011'

const THREAD = {
  id: THREAD_ID,
  title: 'Ein gewöhnliches Thema',
  createdBy: '01900000-0000-7000-8000-0000000000aa',
  createdByUsername: 'federkiel',
  createdAt: '2026-09-22T10:00:00.000Z',
  lastActivityAt: '2026-09-22T10:00:00.000Z',
  folderId: null,
  memberPermission: 'write',
  effectiveMemberPermission: 'write',
  isOfficial: false,
  isFavourite: false,
}

const mocks = vi.hoisted(() => ({
  thread: { value: { status: 200, data: {} as unknown } },
  posts: { value: { status: 200, data: { results: [] as unknown[], totalResults: 0 } } },
  user: {
    value: {
      status: 200,
      data: {
        id: '01900000-0000-7000-8000-0000000000aa',
        platformRole: null as string | null,
        mayPreparePublications: false,
      },
    },
  },
  createPost: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  updatePost: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  pending: <T>(mutateAsync: T) => ({ mutateAsync, isPending: false }),
}))

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRoute: () => ({ params: { threadId: THREAD_ID }, query: {} }),
  useRouter: () => ({ push: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
}))

vi.mock('@/api/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetCurrentUser: () => ({ data: mocks.user }),
}))

vi.mock('@/composables/useForumTree', () => ({
  useForumTree: () => ({ tree: { value: [] } }),
}))

vi.mock('@/composables/useIsOperator', () => ({ useIsOperator: () => ({ value: false }) }))

vi.mock('@/api/forum/forum', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetForumThread: () => ({ data: mocks.thread, isPending: false, isError: false }),
  useListForumPosts: () => ({ data: mocks.posts }),
  useCreateForumPost: () => mocks.pending(mocks.createPost),
  useUpdateForumPost: () => mocks.pending(mocks.updatePost),
  useDeleteForumPost: () => mocks.pending(vi.fn<() => Promise<unknown>>()),
  listForumPosts: vi
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ status: 200, data: { results: [] } }),
  createForumPost: vi
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ status: 201, data: { id: 'draft-1' } }),
  updateForumPost: vi
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ status: 200, data: {} }),
  deleteForumPost: vi
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ status: 200, data: {} }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.thread.value = { status: 200, data: THREAD }
  mocks.posts.value = { status: 200, data: { results: [], totalResults: 0 } }
  mocks.user.value = {
    status: 200,
    data: {
      id: '01900000-0000-7000-8000-0000000000aa',
      platformRole: null,
      mayPreparePublications: false,
    },
  }
  mocks.createPost.mockResolvedValue({ status: 201, data: { id: 'post-1' } })
  mocks.updatePost.mockResolvedValue({ status: 200, data: { id: 'post-1' } })
})

function threadView() {
  return mount(ForumThreadView, {
    global: {
      plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
      stubs: {
        RouterLink: RouterLinkStub,
        PathToHere: true,
        ListPagination: true,
      },
    },
  })
}

describe('ForumThreadView', () => {
  it('zeigt dem Mitglied den Schreibkasten, wo es schreiben darf', async () => {
    const wrapper = threadView()
    await flushPromises()

    expect(wrapper.text()).toContain('Ein gewöhnliches Thema')
    expect(wrapper.findAllComponents({ name: 'PostComposer' })).toHaveLength(1)
  })

  it('schickt den ersten Beitrag ab', async () => {
    const wrapper = threadView()
    await flushPromises()

    const composer = wrapper.findComponent({ name: 'PostComposer' })
    composer.vm.$emit('update:modelValue', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Der erste Beitrag.' }] }],
    })
    composer.vm.$emit('update:text', 'Der erste Beitrag.')
    await flushPromises()

    composer.vm.$emit('submit')
    await flushPromises()

    expect(mocks.createPost).toHaveBeenCalled()
  })

  it('lässt ein Mitglied nicht schreiben, wo es nur lesen darf', async () => {
    mocks.thread.value = {
      status: 200,
      data: { ...THREAD, effectiveMemberPermission: 'read' },
    }

    const wrapper = threadView()
    await flushPromises()

    expect(wrapper.findAllComponents({ name: 'PostComposer' })).toHaveLength(0)
  })
})
