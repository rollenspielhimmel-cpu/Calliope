import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PostItem from '@/components/thread/PostItem.vue'
import type { ListPosts200ResultsItem } from '@/api/models'
import { emptyDocument } from '@/lib/document/emptyDocument'

/**
 * Ein offizieller Beitrag gehört der Administration. `createdBy` ist dort der Absender, nicht der
 * Schreiber — wer als dieses Konto angemeldet ist, ist deshalb nicht sein Autor und bekommt kein
 * „Bearbeiten". Die API prüft das selbst; die Zeile bietet nur an, was sie annimmt.
 */

vi.mock('@/composables/useFavourite', () => ({
  useFavourite: () => ({
    savingFavourite: ref(false),
    favouriteError: ref(undefined),
    changeFavourite: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  }),
}))

const SENDER = 'sender-account'

function post(overrides: Partial<ListPosts200ResultsItem> = {}): ListPosts200ResultsItem {
  return {
    id: 'post-1',
    writingThreadId: 'thread-1',
    text: 'Eine Ankündigung.',
    document: emptyDocument(),
    isDraft: false,
    createdBy: SENDER,
    createdByUsername: 'Infoflamingo',
    createdAt: '2026-09-22T10:00:00Z',
    editedAt: null,
    editedBy: null,
    editedByUsername: null,
    isFavourite: false,
    isUnderReview: false,
    isOfficial: true,
    ...overrides,
  } as ListPosts200ResultsItem
}

function item(props: { currentUserId: string; mayAdminister?: boolean }, isOfficial = true) {
  return mount(PostItem, {
    props: {
      post: post({ isOfficial }),
      divider: false,
      first: true,
      mayWrite: true,
      ...props,
    },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
}

const editButtons = (wrapper: ReturnType<typeof item>) =>
  wrapper.findAll('button').filter((button) => button.text() === 'Bearbeiten')

describe('PostItem, offizieller Beitrag', () => {
  it('bietet dem angemeldeten Absender-Konto kein Bearbeiten an', () => {
    expect(editButtons(item({ currentUserId: SENDER }))).toHaveLength(0)
  })

  it('bietet es der Administration an', () => {
    expect(editButtons(item({ currentUserId: 'admin', mayAdminister: true }))).toHaveLength(1)
  })

  it('lässt beim gewöhnlichen Beitrag den Autor bearbeiten, wie bisher', () => {
    expect(editButtons(item({ currentUserId: SENDER }, false))).toHaveLength(1)
  })
})
