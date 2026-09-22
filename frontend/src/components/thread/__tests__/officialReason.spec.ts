import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import PostItem from '@/components/thread/PostItem.vue'
import DeletePostDialog from '@/components/thread/DeletePostDialog.vue'
import type { ListPosts200ResultsItem } from '@/api/models'
import { emptyDocument } from '@/lib/document/emptyDocument'

/**
 * **Eine freigegebene Aussage ändert sich nicht ohne Grund.** Beim offiziellen Beitrag fragen
 * Bearbeiten und Löschen nach einem, und ohne ihn geht keins von beiden; beim gewöhnlichen fragt
 * keiner danach. Die API verlangt ihn selbst — das hier lässt nur nicht erst abschicken, was sie
 * ablehnt.
 */

vi.mock('@/composables/useFavourite', () => ({
  useFavourite: () => ({
    savingFavourite: ref(false),
    favouriteError: ref(undefined),
    changeFavourite: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  }),
}))

/** Der Editor tippt einmal etwas: sonst bliebe „Speichern" schon wegen „nichts geändert" grau. */
const TypingEditor = defineComponent({
  emits: ['update:document', 'update:text'],
  mounted() {
    this.$emit('update:document', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Korrigiert.' }] }],
    })
    this.$emit('update:text', 'Korrigiert.')
  },
  methods: { focus() {} },
  template: '<div />',
})

function post(isOfficial: boolean): ListPosts200ResultsItem {
  return {
    id: 'post-1',
    writingThreadId: 'thread-1',
    text: 'Eine Ankündigung.',
    document: emptyDocument(),
    isDraft: false,
    createdBy: 'sender',
    createdByUsername: 'Infoflamingo',
    createdAt: '2026-09-22T10:00:00Z',
    editedAt: null,
    editedBy: null,
    editedByUsername: null,
    isFavourite: false,
    isUnderReview: false,
    isOfficial,
  } as ListPosts200ResultsItem
}

async function editing(isOfficial: boolean) {
  const wrapper = mount(PostItem, {
    props: {
      post: post(isOfficial),
      divider: false,
      first: true,
      mayWrite: true,
      mayAdminister: true,
      currentUserId: 'admin',
      editing: true,
      reasonMaxLength: 500,
    },
    global: { stubs: { PostEditor: TypingEditor } },
  })
  await nextTick()
  return wrapper
}

const saveButton = (wrapper: Awaited<ReturnType<typeof editing>>) =>
  wrapper.findAll('button').find((button) => button.text() === 'Speichern')

describe('PostItem, Bearbeiten mit Grund', () => {
  it('lässt einen offiziellen Beitrag ohne Grund nicht speichern', async () => {
    const wrapper = await editing(true)

    expect(wrapper.find('#reason-post-1').exists()).toBe(true)
    expect(saveButton(wrapper)?.attributes('disabled')).toBeDefined()

    await wrapper.find('#reason-post-1').setValue('   ')
    expect(saveButton(wrapper)?.attributes('disabled')).toBeDefined()
  })

  it('schickt den Grund mit', async () => {
    const wrapper = await editing(true)

    await wrapper.find('#reason-post-1').setValue(' Tippfehler im Datum ')
    await saveButton(wrapper)?.trigger('click')

    expect(wrapper.emitted('save')?.[0]?.[2]).toBe('Tippfehler im Datum')
  })

  it('fragt beim gewöhnlichen Beitrag nicht danach', async () => {
    const wrapper = await editing(false)

    expect(wrapper.find('#reason-post-1').exists()).toBe(false)
    await saveButton(wrapper)?.trigger('click')
    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(wrapper.emitted('save')?.[0]?.[2]).toBeUndefined()
  })
})

function deleting(reasonMaxLength?: number) {
  return mount(DeletePostDialog, {
    props: { open: true, pending: false, reasonMaxLength },
    attachTo: document.body,
  })
}

const confirmButton = () =>
  [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Beitrag löschen',
  )

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('DeletePostDialog, Löschen mit Grund', () => {
  it('lässt einen offiziellen Beitrag ohne Grund nicht löschen, und schickt ihn mit', async () => {
    const wrapper = deleting(500)
    await nextTick()

    expect(confirmButton()?.disabled).toBe(true)

    const input = document.body.querySelector<HTMLInputElement>('#delete-post-reason')
    expect(input).not.toBeNull()
    input!.value = 'Doppelt veröffentlicht'
    input!.dispatchEvent(new Event('input'))
    await nextTick()

    expect(confirmButton()?.disabled).toBe(false)
    confirmButton()?.click()
    expect(wrapper.emitted('confirmed')?.[0]?.[0]).toBe('Doppelt veröffentlicht')
  })

  it('fragt beim gewöhnlichen Beitrag nicht danach', async () => {
    const wrapper = deleting()
    await nextTick()

    expect(document.body.querySelector('#delete-post-reason')).toBeNull()
    confirmButton()?.click()
    expect(wrapper.emitted('confirmed')).toHaveLength(1)
    expect(wrapper.emitted('confirmed')?.[0]?.[0]).toBeUndefined()
  })
})
