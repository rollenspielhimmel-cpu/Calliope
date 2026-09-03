import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import MoveThreadDialog from '@/components/forum/MoveThreadDialog.vue'

/**
 * What the move dialog says before it moves anything.
 *
 * The behaviour worth a test is the warning. A thread carrying a visibility of its own keeps it
 * through a move and the stricter of the two still wins — so nothing can be published by accident.
 * A thread *without* one takes on wherever it lands, and that is the only case where moving
 * changes who reads it. Saying so on the wrong case would train people to ignore it.
 */

const moveThread = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })

const OVERVIEW = {
  status: 200,
  data: {
    categories: [
      {
        id: 'category-1',
        title: 'Rund ums Rollenspiel',
        position: 0,
        subForums: [
          {
            id: 'open',
            title: 'Vorstellungen',
            description: '',
            visibility: 'everyone',
            position: 0,
            threads: 0,
            posts: 0,
          },
          {
            id: 'members-only',
            title: 'Werkstatt',
            description: '',
            visibility: 'members',
            position: 1,
            threads: 0,
            posts: 0,
          },
        ],
      },
    ],
  },
}

/**
 * A real ref, not `{ value: false }`: a plain object is truthy, so `v-if="isPending"` would hold
 * the component on its spinner and hide what these assertions are about. Dereferenced only when a
 * hook is called, which keeps it out of the hoisted mock factory's dead zone.
 */
const notPending = ref(false)

vi.mock('@/api/forum/forum', () => ({
  useGetForumOverview: () => ({ data: { value: OVERVIEW } }),
  useMoveForumThread: () => ({ mutateAsync: moveThread, isPending: notPending }),
  getGetForumThreadQueryKey: () => ['api', 'forum', 'threads', 'a-thread'],
}))

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

function moveDialog(visibility: 'everyone' | 'members' | null) {
  return mount(MoveThreadDialog, {
    props: {
      open: true,
      threadId: 'a-thread',
      title: 'Ein Thema',
      subForumId: 'open',
      visibility,
    },
    // Portalled dialog content lands outside the wrapper, so the document is what gets read.
    attachTo: document.body,
  })
}

const WARNING = 'übernimmt deshalb die des Abteils'

/** The dialog's content is portalled, so it is in the document a tick after the mount, not at it. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  moveThread.mockClear()
  document.body.innerHTML = ''
})

describe('MoveThreadDialog', () => {
  it('opens showing where the thread already is', async () => {
    moveDialog(null)
    await settle()

    // The starting value is the truth, not an empty field somebody has to fill in to see it.
    expect(document.body.textContent).toContain('Vorstellungen')
    // And what that place means, so choosing is not a guess about who ends up reading it.
    expect(document.body.textContent).toContain('Alle, auch ohne Konto')
  })

  it('says nothing about readers while the target is where the thread already is', async () => {
    moveDialog(null)
    await settle()

    expect(document.body.textContent).not.toContain(WARNING)
  })

  it('warns when a thread with no setting of its own would change hands', async () => {
    const wrapper = moveDialog(null)

    // Straight to the component's state: the target is chosen through a portalled listbox that
    // reka-ui only builds on a real pointer sequence, and the choosing is not what is under test.
    ;(wrapper.vm as unknown as { target: string }).target = 'members-only'
    await settle()

    expect(document.body.textContent).toContain(WARNING)
  })

  it('stays quiet for a thread that carries its own setting', async () => {
    const wrapper = moveDialog('members')
    ;(wrapper.vm as unknown as { target: string }).target = 'members-only'
    await settle()

    // It keeps that setting through the move, and the stricter of the two still wins, so who
    // reads it cannot change. Warning here would be crying wolf.
    expect(document.body.textContent).not.toContain(WARNING)
  })
})
