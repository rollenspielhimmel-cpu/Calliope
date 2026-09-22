import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import UnmakeOfficialDialog from '@/components/thread/UnmakeOfficialDialog.vue'
import OfficialRevisionsDialog from '@/components/thread/OfficialRevisionsDialog.vue'
import { ApiError } from '@/lib/api/apiFetch'
import { refusalMessage } from '@/lib/format/failure'

/**
 * Der Weg zurück aus „offiziell", und was das Protokoll davon zeigt.
 *
 * **Drei Dinge, die auf der Beta gefehlt haben.** Den Namenstausch konnte niemand zurücknehmen; im
 * Protokoll stand er nicht; und die Begründung des Servers kam nie an, weil der Dialog nur seinen
 * eigenen Auffangsatz zeigte.
 */

const THREAD_ID = '01900000-0000-7000-8000-000000000011'

const mocks = vi.hoisted(() => ({
  unmake: vi.fn<(variables: unknown) => Promise<unknown>>(),
  revisions: { value: { status: 200, data: [] as unknown[] } },
}))

vi.mock('@/api/moderation/moderation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUnmakeOfficialThread: () => ({ mutateAsync: mocks.unmake, isPending: false }),
  useListOfficialThreadRevisions: () => ({ data: mocks.revisions, isPending: false }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  mocks.unmake.mockResolvedValue({ status: 200, data: { ok: true } })
  mocks.revisions.value = { status: 200, data: [] }
})

function undoDialog() {
  return mount(UnmakeOfficialDialog, {
    props: { open: true, threadId: THREAD_ID },
    attachTo: document.body,
  })
}

const confirmButton = () =>
  [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Zurücknehmen',
  )

async function typeReason(text: string) {
  const input = document.body.querySelector<HTMLInputElement>('#unmake-official-reason')
  input!.value = text
  input!.dispatchEvent(new Event('input'))
  await flushPromises()
}

describe('UnmakeOfficialDialog', () => {
  it('nimmt nicht ohne Grund zurück', async () => {
    const wrapper = undoDialog()
    await flushPromises()

    expect(confirmButton()?.disabled).toBe(true)
    await typeReason('   ')
    expect(confirmButton()?.disabled).toBe(true)
    expect(mocks.unmake).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('schickt den Grund mit und schließt sich', async () => {
    const wrapper = undoDialog()
    await flushPromises()

    await typeReason('Falschen Absender gewählt')
    confirmButton()?.click()
    await flushPromises()

    expect(mocks.unmake).toHaveBeenCalledWith({
      threadId: THREAD_ID,
      params: { reason: 'Falschen Absender gewählt' },
    })
    expect(wrapper.emitted('changed')).toHaveLength(1)
    wrapper.unmount()
  })

  /**
   * **Der Satz des Servers, nicht meiner.** Bei „Offiziell machen" stand auf der Beta nur „Das ging
   * nicht durch", während der Server längst erklärt hatte, woran es lag.
   */
  it('zeigt, was der Server begründet abgelehnt hat', async () => {
    mocks.unmake.mockRejectedValue(
      new ApiError(409, {
        error: 'Dieser Thread wurde als offizieller geschrieben; es gibt keinen Namen.',
      }),
    )

    const wrapper = undoDialog()
    await flushPromises()
    await typeReason('Doch nicht')
    confirmButton()?.click()
    await flushPromises()

    expect(document.body.textContent).toContain('als offizieller geschrieben')
    expect(document.body.textContent).not.toContain('Versuche es noch einmal')
    wrapper.unmount()
  })
})

describe('refusalMessage', () => {
  it('nimmt den Satz des Servers bei 403, 404 und 409', () => {
    for (const status of [403, 404, 409]) {
      expect(refusalMessage(new ApiError(status, { error: 'Steht so da.' }), 'Auffang')).toBe(
        'Steht so da.',
      )
    }
  })

  it('lässt alles andere beim eigenen Satz', () => {
    // Ein 500 trägt keinen Satz für Menschen, und ein 400 heißt: Client und Server sind uneins.
    expect(refusalMessage(new ApiError(500, { error: 'Unexpected failure' }), 'Auffang')).toBe(
      'Auffang',
    )
    expect(refusalMessage(new ApiError(403, { error: '   ' }), 'Auffang')).toBe('Auffang')
  })
})

function revisionsDialog() {
  return mount(OfficialRevisionsDialog, {
    props: { open: true, threadId: THREAD_ID },
    attachTo: document.body,
  })
}

describe('OfficialRevisionsDialog, Namenstausch', () => {
  it('führt auf, dass der Thread offiziell wurde, und unter welchem Namen', async () => {
    mocks.revisions.value = {
      status: 200,
      data: [
        {
          id: '01900000-0000-7000-8000-0000000000a2',
          kind: 'unmade_official',
          editedByUsername: 'rabe',
          editedAt: '2026-09-22T12:00:00.000Z',
          reason: 'Falschen Absender gewählt',
          titleBefore: null,
          titleAfter: null,
          textBefore: null,
          textAfter: null,
          nameBefore: 'federkiel',
          nameAfter: 'Admin',
        },
        {
          id: '01900000-0000-7000-8000-0000000000a1',
          kind: 'made_official',
          editedByUsername: 'rabe',
          editedAt: '2026-09-22T11:00:00.000Z',
          reason: null,
          titleBefore: null,
          titleAfter: null,
          textBefore: null,
          textAfter: null,
          nameBefore: 'Admin',
          nameAfter: 'federkiel',
        },
      ],
    }

    const wrapper = revisionsDialog()
    await flushPromises()

    const text = document.body.textContent ?? ''
    expect(text).toContain('Offiziell gemacht')
    expect(text).toContain('Nicht mehr offiziell')
    expect(text).toContain('Stand als')
    expect(text).toContain('Steht als')
    expect(text).toContain('federkiel')
    expect(text).toContain('Falschen Absender gewählt')
    // Ohne Grund steht auch kein leeres „Grund:" da.
    expect(text).not.toContain('Grund: \n')
    wrapper.unmount()
  })
})
