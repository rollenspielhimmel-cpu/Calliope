import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PostItem from '@/components/thread/PostItem.vue'
import type { ListPosts200ResultsItem } from '@/api/models'
import { emptyDocument } from '@/lib/document/emptyDocument'

/**
 * The notice on a post moderation is looking at.
 *
 * Its wording is the point, which is why it is pinned here. An automatically raised Blind-Date
 * name suspicion is **not a finding** — a username can be an ordinary German word — so the notice
 * says what is happening and never what anybody did. It sits *beside* the post, which is shown
 * exactly as written: masking on a suspicion would disfigure innocent prose before a person had
 * looked at it, which is the mistake the automatic version made.
 */

const notPending = ref(false)

vi.mock('@/composables/useFavourite', () => ({
  useFavourite: () => ({
    savingFavourite: notPending,
    favouriteError: ref(undefined),
    changeFavourite: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  }),
}))

function post(overrides: Partial<ListPosts200ResultsItem> = {}): ListPosts200ResultsItem {
  return {
    id: 'post-1',
    writingThreadId: 'thread-1',
    text: 'Bis morgen! Liebe Grüße, federkiel',
    document: {
      ...emptyDocument(),
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Bis morgen! Liebe Grüße, federkiel' }],
        },
      ],
    },
    isDraft: false,
    createdBy: 'user-1',
    createdByUsername: 'Blind-Date-Partner 1',
    createdAt: '2026-09-03T10:00:00Z',
    editedAt: null,
    editedBy: null,
    editedByUsername: null,
    isFavourite: false,
    isUnderReview: false,
    ...overrides,
  } as ListPosts200ResultsItem
}

function item(overrides: Partial<ListPosts200ResultsItem> = {}) {
  return mount(PostItem, {
    props: {
      post: post(overrides),
      divider: false,
      first: true,
      currentUserId: 'user-2',
    },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
}

const NOTICE = 'Dieser Beitrag wird gerade von der Moderation geprüft.'

describe('PostItem, under review', () => {
  it('says nothing on an ordinary post', () => {
    expect(item().text()).not.toContain(NOTICE)
  })

  it('shows the notice while moderation is looking', () => {
    expect(item({ isUnderReview: true }).text()).toContain(NOTICE)
  })

  it('leaves the post itself exactly as written', () => {
    const wrapper = item({ isUnderReview: true })

    // The whole reason the guard stopped acting on its own: a username may be an ordinary word,
    // and hiding it before a human looked would disfigure somebody's sentence for nothing.
    expect(wrapper.text()).toContain('Bis morgen! Liebe Grüße, federkiel')
    expect(wrapper.text()).not.toContain('***')
  })

  it('accuses nobody', () => {
    // The notice itself, not the whole post: the author's pseudonym is „Blind-Date-Partner 1",
    // so reading the component's full text matched on the name beside the notice rather than on
    // anything the notice says.
    const notice = item({ isUnderReview: true }).find('[role="status"]').text().toLowerCase()

    // A suspicion is not a finding, and the person reading this may be the one it is about.
    for (const word of ['verstoß', 'verboten', 'regel', 'name', 'blind-date', 'anonym']) {
      expect(notice).not.toContain(word)
    }
  })
})
