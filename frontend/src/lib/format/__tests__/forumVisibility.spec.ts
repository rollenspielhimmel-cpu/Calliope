import { describe, expect, it } from 'vitest'
import {
  FORUM_VISIBILITY_LABELS,
  reachableVisibilities,
  restrictedForumLabel,
} from '../forumVisibility'

describe('FORUM_VISIBILITY_LABELS', () => {
  it('names all four, in the order the enum is declared', () => {
    // The object is iterated to build a form's choices, so its order is what somebody reads.
    expect(Object.keys(FORUM_VISIBILITY_LABELS)).toEqual([
      'everyone',
      'members',
      'moderation',
      'administration',
    ])
  })
})

describe('restrictedForumLabel', () => {
  it('says nothing for the ordinary cases', () => {
    // A forum being readable is what a forum is; a badge on every row would be noise.
    expect(restrictedForumLabel('everyone')).toBeUndefined()
    expect(restrictedForumLabel('members')).toBeUndefined()
  })

  it('names the closed ones with the same words the form uses', () => {
    expect(restrictedForumLabel('moderation')).toBe(FORUM_VISIBILITY_LABELS.moderation)
    expect(restrictedForumLabel('administration')).toBe(FORUM_VISIBILITY_LABELS.administration)
  })
})

describe('reachableVisibilities', () => {
  it('stops a moderator below administration', () => {
    // The rule the API applies: nobody may put a thread beyond their own reach, because they
    // could then not bring it back. Offering it and letting the request fail is worse.
    expect(reachableVisibilities('moderator')).toEqual(['everyone', 'members', 'moderation'])
  })

  it('lets an administrator reach everything', () => {
    expect(reachableVisibilities('administrator')).toEqual([
      'everyone',
      'members',
      'moderation',
      'administration',
    ])
  })

  it('stops an account with no role at members', () => {
    // Not reachable through the interface — the tools are moderation-only — but the helper
    // answers for itself rather than trusting its one caller.
    expect(reachableVisibilities(null)).toEqual(['everyone', 'members'])
    expect(reachableVisibilities(undefined)).toEqual(['everyone', 'members'])
  })
})
