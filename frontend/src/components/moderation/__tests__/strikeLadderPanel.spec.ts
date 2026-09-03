import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import StrikeLadderPanel from '@/components/moderation/StrikeLadderPanel.vue'

/**
 * Which rung a member is filed under.
 *
 * The rule is **the highest rung reached, once**. Somebody on their second strike also has two
 * warnings behind them, so a naive filter per rung would list them three times and make the page
 * twice as long as the problem. The other half is that an empty rung is left out — a heading over
 * nothing is a section somebody reads and learns nothing from.
 */

const notPending = ref(false)

type Standing = {
  id: string
  username: string
  warnings: number
  suspensions: number
  suspendedUntil: string | null
  suspensionReason: string | null
  bannedAt: string | null
  lastStrikeAt: string
  watchlistNote: string | null
}

function standing(overrides: Partial<Standing> & { username: string }): Standing {
  return {
    id: overrides.username,
    warnings: 0,
    suspensions: 0,
    suspendedUntil: null,
    suspensionReason: null,
    bannedAt: null,
    lastStrikeAt: '2026-09-01T10:00:00Z',
    watchlistNote: null,
    ...overrides,
  }
}

const ladder = { value: { status: 200, data: [] as Standing[] } }

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useListStrikeLadder: () => ({ data: ladder, isPending: notPending }),
}))

function panel() {
  return mount(StrikeLadderPanel, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
}

/** The section headings, in the order they are rendered. */
function headings(wrapper: ReturnType<typeof panel>): string[] {
  return wrapper.findAll('h3').map((one) => one.text().replace(/\s*\(\d+\)$/u, ''))
}

beforeEach(() => {
  ladder.value = { status: 200, data: [] }
})

describe('StrikeLadderPanel', () => {
  it('says the ladder is empty rather than showing empty headings', () => {
    const wrapper = panel()

    expect(headings(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('Niemand hat eine Verwarnung oder einen Strike')
  })

  it('files somebody under the highest rung they reached, and only once', () => {
    // Two warnings and two strikes: the rung is „2. Strike", not all three sections at once.
    ladder.value = {
      status: 200,
      data: [standing({ username: 'federkiel', warnings: 2, suspensions: 2 })],
    }

    const wrapper = panel()

    expect(headings(wrapper)).toEqual(['2. Strike'])
    expect(wrapper.findAll('li')).toHaveLength(1)
  })

  it('orders the sections worst first', () => {
    ladder.value = {
      status: 200,
      data: [
        standing({ username: 'eins', warnings: 1 }),
        standing({ username: 'zwei', warnings: 2 }),
        standing({ username: 'strike', warnings: 2, suspensions: 1 }),
        standing({ username: 'gesperrt', bannedAt: '2026-08-01T10:00:00Z' }),
      ],
    }

    expect(headings(panel())).toEqual([
      'Gesperrtes Konto',
      '1. Strike',
      '2. Verwarnung',
      '1. Verwarnung',
    ])
  })

  it('puts a fourth suspension in the last section rather than inventing a rung', () => {
    ladder.value = {
      status: 200,
      data: [standing({ username: 'federkiel', warnings: 2, suspensions: 4 })],
    }

    expect(headings(panel())).toEqual(['3. Strike und weiter'])
  })

  it('takes a banned account off the ladder into its own section', () => {
    // A ban outranks every rung: the ladder has nowhere further to go.
    ladder.value = {
      status: 200,
      data: [
        standing({
          username: 'federkiel',
          warnings: 2,
          suspensions: 3,
          bannedAt: '2026-08-01T10:00:00Z',
        }),
      ],
    }

    expect(headings(panel())).toEqual(['Gesperrtes Konto'])
  })

  it('marks a running suspension and stays quiet about a served one', () => {
    ladder.value = {
      status: 200,
      data: [
        standing({
          username: 'laufend',
          warnings: 2,
          suspensions: 1,
          suspendedUntil: '2099-01-01T10:00:00Z',
        }),
      ],
    }
    expect(panel().text()).toContain('aktuell gesperrt')

    // The API nulls the field once the suspension has run out, so nothing here says otherwise.
    ladder.value = {
      status: 200,
      data: [standing({ username: 'abgesessen', warnings: 2, suspensions: 1 })],
    }
    expect(panel().text()).not.toContain('aktuell gesperrt')
  })

  it('shows the watchlist note beside the standing', () => {
    // The reason the two lists share a page at all.
    ladder.value = {
      status: 200,
      data: [standing({ username: 'federkiel', warnings: 1, watchlistNote: 'Im Auge behalten' })],
    }

    expect(panel().text()).toContain('Auf der Beobachtungsliste: Im Auge behalten')
  })

  it('counts one warning as one', () => {
    ladder.value = {
      status: 200,
      data: [standing({ username: 'federkiel', warnings: 1 })],
    }

    expect(panel().text()).toContain('1 Verwarnung ·')
    expect(panel().text()).not.toContain('1 Verwarnungen')
  })
})
