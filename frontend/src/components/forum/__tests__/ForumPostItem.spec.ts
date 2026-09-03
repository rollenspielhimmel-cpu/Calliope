import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ForumPostItem from '@/components/forum/ForumPostItem.vue'
import type { ListForumPosts200ResultsItem, PostDocument } from '@/api/models'

/**
 * The row of actions under a forum post, which is where authorisation shows up in the interface.
 *
 * The point of these is that the row never offers what the API would refuse: `updateForumPost`
 * and `deleteForumPost` accept your own post or a moderator's hand, and `createReport` refuses
 * your own writing. A button offered wrongly is a member told they may do something and then
 * refused, which is the failure worth a test.
 *
 * Mounted for real rather than shallow: the buttons under test are plain elements in this
 * component's own template, and stubbing its children renders no slots at all.
 */

const setFavourite = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })
const clearFavourite = vi.fn<() => Promise<unknown>>().mockResolvedValue({ status: 200 })

vi.mock('@/api/favourites/favourites', () => ({
  useSetFavourite: () => ({ mutateAsync: setFavourite }),
  useClearFavourite: () => ({ mutateAsync: clearFavourite }),
}))

const DOCUMENT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein Absatz.' }] }],
} as unknown as PostDocument

function aPost(overrides: Partial<ListForumPosts200ResultsItem> = {}) {
  return {
    id: 'a-post',
    document: DOCUMENT,
    text: 'Ein Absatz.',
    createdAt: '2026-09-01T10:00:00Z',
    createdBy: 'the-author',
    createdByUsername: 'federkiel',
    editedAt: null,
    editedByUsername: null,
    isFavourite: false,
    ...overrides,
  } satisfies ListForumPosts200ResultsItem
}

function postItem(props: Partial<InstanceType<typeof ForumPostItem>['$props']> = {}) {
  return mount(ForumPostItem, {
    props: { post: aPost(), divider: false, first: true, ...props },
  })
}

/** The row is text actions, so what it offers is read as words. */
function actions(wrapper: ReturnType<typeof postItem>): string[] {
  return wrapper.findAll('button').map((button) => button.text())
}

beforeEach(() => {
  setFavourite.mockClear()
  clearFavourite.mockClear()
})

describe('ForumPostItem', () => {
  it('offers nothing to a reader without an account', () => {
    // Not even the favourite: all three need somebody to act as.
    expect(actions(postItem())).toEqual([])
  })

  it('offers editing and deleting on your own post, and no way to report it', () => {
    const wrapper = postItem({ currentUserId: 'the-author' })

    expect(actions(wrapper)).toEqual(['Bearbeiten', 'Löschen', 'Favorit'])
  })

  it('offers reporting and favouriting on somebody else’s, and no way to change it', () => {
    const wrapper = postItem({ currentUserId: 'a-reader' })

    expect(actions(wrapper)).toEqual(['Favorit', 'Melden'])
  })

  it('lets moderation change somebody else’s post', () => {
    const wrapper = postItem({ currentUserId: 'a-reader', mayModerate: true })

    expect(actions(wrapper)).toEqual(['Bearbeiten', 'Löschen', 'Favorit', 'Melden'])
  })

  it('still offers reporting a post whose author deleted their account', () => {
    // The writing is still there, and removing it is still something an operator can do.
    const wrapper = postItem({
      post: aPost({ createdBy: null, createdByUsername: null }),
      currentUserId: 'a-reader',
    })

    expect(actions(wrapper)).toContain('Melden')
    expect(actions(wrapper)).not.toContain('Bearbeiten')
    expect(wrapper.text()).toContain('Gelöschtes Konto')
  })

  it('names the state a click will put the favourite in, not the act', async () => {
    const wrapper = postItem({ post: aPost({ isFavourite: true }), currentUserId: 'a-reader' })

    expect(actions(wrapper)).toContain('Kein Favorit')

    await wrapper.findAll('button').at(0)?.trigger('click')

    expect(clearFavourite).toHaveBeenCalledWith({
      targetType: 'forum_post',
      targetId: 'a-post',
    })
    expect(wrapper.emitted('favouriteChanged')).toHaveLength(1)
  })

  it('favourites a post as a forum post, not as a writing post', async () => {
    const wrapper = postItem({ currentUserId: 'a-reader' })

    await wrapper.findAll('button').at(0)?.trigger('click')

    expect(setFavourite).toHaveBeenCalledWith({
      targetType: 'forum_post',
      targetId: 'a-post',
    })
  })

  it('says who edited a post only when it was not the author', () => {
    const own = postItem({
      post: aPost({ editedAt: '2026-09-01T11:00:00Z', editedByUsername: 'federkiel' }),
    })
    expect(own.text()).toContain('bearbeitet')
    expect(own.text()).not.toContain('bearbeitet von')

    const byModeration = postItem({
      post: aPost({ editedAt: '2026-09-01T11:00:00Z', editedByUsername: 'aufsicht' }),
    })
    expect(byModeration.text()).toContain('bearbeitet von aufsicht')
  })

  it('offers saving only once the writing has actually changed', async () => {
    const wrapper = postItem({ currentUserId: 'the-author', editing: true })

    const save = wrapper.findAll('button').find((button) => button.text() === 'Speichern')
    // Opened on the stored document, so nothing has changed yet and Speichern stays dark.
    expect(save?.attributes('disabled')).toBeDefined()
  })
})
