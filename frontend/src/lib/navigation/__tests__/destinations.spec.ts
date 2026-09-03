import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'
import { DESTINATIONS, isCurrent } from '@/lib/navigation/destinations'
import { routes } from '@/router/routes'

/**
 * The bars are built from this list, so what it says is what a member can reach in one press.
 * Which view each destination opens is a product decision — members reported the old menu as a
 * click they should not have to make — and nothing else in the suite would notice it changing.
 */
function routeNames(records: readonly RouteRecordRaw[]): string[] {
  return records.flatMap((record) => [
    ...(typeof record.name === 'string' ? [record.name] : []),
    ...routeNames(record.children ?? []),
  ])
}

const NAMES = routeNames(routes)

describe('DESTINATIONS', () => {
  it('opens the view members actually want, in one press', () => {
    expect(DESTINATIONS.map((destination) => [destination.label, destination.name])).toEqual([
      // First, ahead of the groups: the forum is the open half of the site, and the one place
      // somebody without an account can arrive at.
      ['Forum', 'forum'],
      ['Gruppen', 'myGroups'],
      // The carousel rather than either list: reading through unread ideas is the point of the page.
      ['Storyideen', 'storyIdeasCarousel'],
      // Fifth and last: a destination somebody visits deliberately rather than daily. Five fit the
      // bottom bar at 375px with their labels; a sixth would not, and is where this list needs a
      // different shape rather than one more entry.
      ['Blind-Date', 'blindDate'],
      ['Mitglieder', 'members'],
    ])
  })

  it('names routes that exist', () => {
    // A renamed route would otherwise leave a bar item that navigates nowhere, or one that never
    // marks itself — the second is silent, which is how `/groups/discover` drifted once before.
    const named = DESTINATIONS.flatMap((destination) => [
      ...(destination.name === undefined ? [] : [destination.name]),
      ...destination.belongsTo,
    ])

    expect(named.filter((name) => !NAMES.includes(name))).toEqual([])
  })

  it('marks a destination while any of its pages is open', () => {
    // Found by name rather than by index, so adding a destination ahead of it does not silently
    // move the assertion onto a different one.
    const groups = DESTINATIONS.find((destination) => destination.label === 'Gruppen')
    expect(groups && isCurrent(groups, 'discoverGroups')).toBe(true)
    expect(groups && isCurrent(groups, 'thread')).toBe(true)
    expect(groups && isCurrent(groups, 'members')).toBe(false)
  })
})
