import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import ThreadVisibilityDialog from '@/components/forum/ThreadVisibilityDialog.vue'

/**
 * What the visibility dialog offers, and what it sends.
 *
 * Two things are worth holding: `null` is „Wie das Abteil" rather than a fifth level — the wire
 * value has to be null and not the string — and the choices stop at this account's own reach, the
 * same rule the API applies. Offering `administration` to a moderator and letting the request come
 * back 403 would be telling somebody they may do something and then refusing.
 */

const setVisibility = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })

const currentUser = { value: { status: 200, data: { platformRole: 'moderator' } } }

/**
 * A real ref, not `{ value: false }`: a plain object is truthy, so `v-if="isPending"` would hold
 * the component on its spinner and hide what these assertions are about. Dereferenced only when a
 * hook is called, which keeps it out of the hoisted mock factory's dead zone.
 */
const notPending = ref(false)

vi.mock('@/api/forum/forum', () => ({
  useSetForumThreadVisibility: () => ({
    mutateAsync: setVisibility,
    isPending: notPending,
  }),
  getGetForumThreadQueryKey: () => ['api', 'forum', 'threads', 'a-thread'],
}))

vi.mock('@/api/auth/auth', () => ({
  useGetCurrentUser: () => ({ data: currentUser }),
}))

vi.mock('@/lib/api/queryClient', () => ({
  queryClient: { invalidateQueries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}))

function visibilityDialog(visibility: 'members' | 'moderation' | null) {
  return mount(ThreadVisibilityDialog, {
    props: {
      open: true,
      threadId: 'a-thread',
      title: 'Ein Thema',
      visibility,
      effectiveVisibility: 'everyone',
    },
    attachTo: document.body,
  })
}

/** The dialog's content is portalled, so it is in the document a tick after the mount, not at it. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The words the closed trigger shows, which is the current setting said back. */
function shown(): string {
  return document.body.textContent ?? ''
}

beforeEach(() => {
  setVisibility.mockClear()
  currentUser.value = { status: 200, data: { platformRole: 'moderator' } }
  document.body.innerHTML = ''
})

describe('ThreadVisibilityDialog', () => {
  it('opens on the thread’s own setting', async () => {
    visibilityDialog('moderation')
    await settle()

    expect(shown()).toContain('Nur Moderation')
  })

  it('names the inherited case for what it is, with what it currently means', async () => {
    visibilityDialog(null)
    await settle()

    // Not an empty field and not „everyone": a thread without a setting of its own follows the
    // sub-forum, and saying which one it lands on is the difference between a state and a choice.
    expect(shown()).toContain('Wie das Abteil (Alle, auch ohne Konto)')
  })

  it('sends null for the inherited case, not the word', async () => {
    const wrapper = visibilityDialog('moderation')
    ;(wrapper.vm as unknown as { chosen: string }).chosen = 'inherit'
    await settle()

    await (wrapper.vm as unknown as { confirm: () => Promise<void> }).confirm()

    expect(setVisibility).toHaveBeenCalledWith({
      threadId: 'a-thread',
      data: { visibility: null },
    })
  })

  it('sends the chosen level as itself', async () => {
    const wrapper = visibilityDialog(null)
    ;(wrapper.vm as unknown as { chosen: string }).chosen = 'moderation'
    await settle()

    await (wrapper.vm as unknown as { confirm: () => Promise<void> }).confirm()

    expect(setVisibility).toHaveBeenCalledWith({
      threadId: 'a-thread',
      data: { visibility: 'moderation' },
    })
  })

  it('does not offer a moderator a level they could not undo', async () => {
    const wrapper = visibilityDialog(null)
    await settle()

    const labels = (wrapper.vm as unknown as { choices: Array<{ value: string }> }).choices.map(
      (choice) => choice.value,
    )

    expect(labels).toEqual(['inherit', 'everyone', 'members', 'moderation'])
  })

  it('offers an administrator the level a moderator cannot reach', async () => {
    currentUser.value = { status: 200, data: { platformRole: 'administrator' } }

    const wrapper = visibilityDialog(null)
    await settle()

    const labels = (wrapper.vm as unknown as { choices: Array<{ value: string }> }).choices.map(
      (choice) => choice.value,
    )

    expect(labels).toContain('administration')
  })
})
