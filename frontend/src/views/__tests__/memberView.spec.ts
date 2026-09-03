import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import MemberView from '@/views/MemberView.vue'

/**
 * The one number on a profile, and the two rules that keep it from becoming a score.
 *
 * It is sent by the API only to the member themselves, so this is the second lock rather than the
 * only one — but the second lock is the one that would rot: a later edit that moves the line out of
 * its `isOwnProfile` branch would show a `0` on every stranger's page and nothing would complain.
 *
 * The other rule is that zero says nothing at all. „0 Blind-Dates abgeschlossen" on a page with no
 * other figures on it reads as a target, and a target is the thing this platform decided against.
 */

const notPending = ref(false)

const profile = {
  value: {
    status: 200,
    data: {
      id: 'user-1',
      username: 'federkiel',
      createdAt: '2026-01-04T10:00:00Z',
      platformRole: null,
      avatarUrl: null,
      isBlocked: false,
      aboutMe: 'Schreibt abends.',
      writingStyle: null,
      postLength: null,
      writingFrequency: null,
      coWriterExpectations: null,
      writingBoundaries: null,
      genres: null,
    } as Record<string, unknown>,
  },
}

const currentUser = { value: { status: 200, data: { id: 'user-1', platformRole: null } } }

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRoute: () => ({ params: { userId: 'user-1' } }),
}))

vi.mock('@/api/users/users', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetUser: () => ({ data: profile, isPending: notPending, error: ref(undefined) }),
  useLiftUserBan: () => ({ mutateAsync: vi.fn<() => Promise<unknown>>(), isPending: notPending }),
}))

vi.mock('@/api/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useGetCurrentUser: () => ({ data: currentUser }),
}))

vi.mock('@/api/blocks/blocks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUnblockMember: () => ({ mutateAsync: vi.fn<() => Promise<unknown>>(), isPending: notPending }),
}))

function memberView() {
  return mount(MemberView, {
    global: {
      stubs: {
        RouterLink: true,
        AppLayout: { template: '<div><slot /></div>' },
        ProfileAnswers: true,
        MemberModerationTools: true,
        ProfileDialog: true,
        BanMemberDialog: true,
        BlockMemberDialog: true,
        ReportDialog: true,
      },
    },
  })
}

describe('MemberView', () => {
  beforeEach(() => {
    profile.value.data.completedBlindDates = 3
    currentUser.value = { status: 200, data: { id: 'user-1', platformRole: null } }
  })

  it('says how many Blind-Dates one has completed, on one own profile', () => {
    expect(memberView().text()).toContain('3 Blind-Dates abgeschlossen')
  })

  it('says one in words rather than as a figure', () => {
    profile.value.data.completedBlindDates = 1

    expect(memberView().text()).toContain('Ein Blind-Date abgeschlossen')
  })

  it('says nothing at zero', () => {
    profile.value.data.completedBlindDates = 0

    expect(memberView().text()).not.toContain('abgeschlossen')
  })

  it('says nothing on somebody else profile, even if a count reached the page', () => {
    // The API does not send the field to anybody else; this asserts the view would not show it
    // even if one day it did.
    currentUser.value = { status: 200, data: { id: 'user-2', platformRole: null } }

    expect(memberView().text()).not.toContain('abgeschlossen')
  })
})
