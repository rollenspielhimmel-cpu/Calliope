import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { VueQueryPlugin } from '@tanstack/vue-query'
import StatusUpdateItem from '@/components/status/StatusUpdateItem.vue'
import QuotedComment from '@/components/status/QuotedComment.vue'

/**
 * Eine Statusmeldung mit ihren Kommentaren.
 *
 * **Der Fall, für den es diese Datei gibt:** Nach dem Absenden stand der Text wieder im Feld. Nicht,
 * weil das Leeren vergessen worden wäre — es stand da, als `input.value = ''` — sondern weil
 * `Input` seinen Wert selbst hält und ihn beim nächsten Zeichnen zurückschreibt. Und gezeichnet
 * wird sofort, weil die Kommentarliste sich gerade geändert hat.
 *
 * Ein Fehler, den man im Diff nicht sieht: Die Zeile, die leert, ist da und sieht richtig aus.
 */

const update = {
  id: 's1',
  body: 'Heute nur eine Zeile geschrieben.',
  createdAt: '2026-09-06T10:00:00.000Z',
  createdBy: 'u1',
  createdByUsername: 'federkiel',
  commentCount: 2,
}

const existingComment = {
  id: 'c0',
  statusUpdateId: 's1',
  body: 'Das ist ein ziemlich langer Kommentar, der beim Zitieren gekuerzt werden muss, damit die Zeile eine Zeile bleibt.',
  createdAt: '2026-09-06T10:02:00.000Z',
  createdBy: 'u3',
  createdByUsername: 'randnotiz',
  quotedComment: null,
}

const createdComment = {
  id: 'c1',
  statusUpdateId: 's1',
  body: 'Immerhin eine.',
  createdAt: '2026-09-06T10:05:00.000Z',
  createdBy: 'u2',
  createdByUsername: 'tintenfleck',
  quotedComment: null,
}

/** Eine Antwort, die den Kommentar darüber zitiert — so kommt sie vom Server zurück. */
const quotingComment = {
  id: 'c2',
  statusUpdateId: 's1',
  body: 'Genau das meinte ich auch.',
  createdAt: '2026-09-06T10:08:00.000Z',
  createdBy: 'u2',
  createdByUsername: 'tintenfleck',
  quotedComment: {
    id: 'c0',
    body: existingComment.body,
    createdBy: 'u3',
    createdByUsername: 'randnotiz',
  },
}

const createComment = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const setSubscription = vi.fn<(...args: unknown[]) => Promise<unknown>>()

vi.mock('@/api/status-updates/status-updates', () => ({
  useListStatusUpdateComments: () => ({
    data: ref({
      status: 200,
      data: { totalResults: 2, results: [existingComment, quotingComment] },
    }),
    isPending: ref(false),
    refetch: () => Promise.resolve(),
  }),
  createStatusUpdateComment: (...args: unknown[]) => createComment(...args),
  useGetStatusUpdateSubscription: () => ({
    data: ref({ status: 200, data: { subscribed: true, explicit: false } }),
    refetch: () => Promise.resolve(),
  }),
  setStatusUpdateSubscription: (...args: unknown[]) => setSubscription(...args),
  listStatusUpdates: () =>
    Promise.resolve({ status: 200, data: { results: [update], nextCursor: null } }),
  getListStatusUpdatesQueryKey: () => ['QUERY', 'api', 'status-updates', {}],
}))

function item(layout: 'box' | 'page' = 'box') {
  return mount(StatusUpdateItem, {
    props: { update, layout },
    global: { plugins: [VueQueryPlugin], stubs: { RouterLink: RouterLinkStub } },
  })
}

async function itemWithCommentsOpen(layout: 'box' | 'page' = 'box') {
  const wrapper = item(layout)
  await flushPromises()

  // Die Kommentare hängen hinter dem Aufklapper; ohne ihn gibt es kein Feld.
  const toggle = wrapper.findAll('button').find((button) => button.text().includes('2'))
  await toggle?.trigger('click')
  await flushPromises()

  return wrapper
}

describe('StatusUpdateItem, kommentieren', () => {
  it('leert das Kommentarfeld, nachdem der Kommentar angekommen ist', async () => {
    createComment.mockResolvedValue({ status: 201, data: createdComment })

    const wrapper = await itemWithCommentsOpen()
    const field = wrapper.find('input[type="text"]')
    expect(field.exists()).toBe(true)

    await field.setValue('Immerhin eine.')
    await field.trigger('keydown.enter')
    await flushPromises()

    expect(createComment).toHaveBeenCalled()
    expect((field.element as HTMLInputElement).value).toBe('')
  })

  it('behält den Text, wenn das Absenden fehlschlägt', async () => {
    // Sonst wäre ein Aussetzer der Verbindung gleichbedeutend damit, das Geschriebene zu verlieren.
    createComment.mockResolvedValue({ status: 500, data: { error: 'kaputt' } })

    const wrapper = await itemWithCommentsOpen()
    const field = wrapper.find('input[type="text"]')

    await field.setValue('Immerhin eine.')
    await field.trigger('keydown.enter')
    await flushPromises()

    expect((field.element as HTMLInputElement).value).toBe('Immerhin eine.')
  })

  /**
   * Der Scrollbereich in einem Scrollbereich: Er saß im Kasten, der selbst scrollt, und zeigte
   * vier Kommentare durch ein Guckloch von 160 Pixeln. Jetzt scrollt nur der Kasten.
   */
  it('setzt die Kommentare nicht in einen eigenen Scrollbereich', async () => {
    createComment.mockResolvedValue({ status: 201, data: createdComment })

    const wrapper = await itemWithCommentsOpen()

    expect(wrapper.html()).not.toContain('max-h-40')
    expect(wrapper.findAll('.overflow-y-auto')).toHaveLength(0)
  })
})

describe('StatusUpdateItem, der Weg zur Seite', () => {
  it('führt von der Uhrzeit im Kasten auf die Seite, zu genau dieser Meldung', async () => {
    const wrapper = item('box')
    await flushPromises()

    const links = wrapper.findAllComponents(RouterLinkStub)
    const toPage = links.find(
      (link) => (link.props('to') as { name?: string } | undefined)?.name === 'statusUpdates',
    )

    expect(toPage).toBeDefined()
    expect(toPage?.props('to')).toMatchObject({ name: 'statusUpdates', hash: '#s1' })
  })

  it('verweist auf der Seite selbst nicht auf die Seite', async () => {
    // Ein Verweis auf die Stelle, an der man schon steht, ist kein Angebot, sondern Rauschen.
    const wrapper = item('page')
    await flushPromises()

    const links = wrapper.findAllComponents(RouterLinkStub)
    const toPage = links.find(
      (link) => (link.props('to') as { name?: string } | undefined)?.name === 'statusUpdates',
    )

    expect(toPage).toBeUndefined()
  })

  /** Der Anker, auf den die Uhrzeit zeigt — ohne ihn landet man oben statt bei der Meldung. */
  it('trägt ihre Kennung als Anker', async () => {
    const wrapper = item('page')
    await flushPromises()

    expect(wrapper.find('#s1').exists()).toBe(true)
  })
})

/**
 * Der „Antworten"-Knopf am **ältesten** Kommentar.
 *
 * Die Liste läuft neueste zuerst, also steht der älteste unten — und seiner ist der letzte Knopf.
 * Die Tests beziehen sich auf ihn, weil er derjenige mit der bekannten Kennung `c0` ist.
 */
function replyToOldest(wrapper: ReturnType<typeof item>) {
  // Über eine Zwischenvariable statt `.at(-1)` oder `findLast`: Das eine hält der Linter für ein
  // verkapptes `find`, das andere gibt es erst ab ES2023.
  const buttons = wrapper.findAll('button').filter((button) => button.text() === 'Antworten')
  return buttons[buttons.length - 1]
}

/** Der Streifen über dem Eingabefeld — der einzige, der sich verwerfen lässt. */
function draftQuote(wrapper: ReturnType<typeof item>) {
  return wrapper.findAllComponents(QuotedComment).find((chip) => chip.props('removable') === true)
}

describe('Antworten', () => {
  /**
   * **Als Bezug, nicht als Text.** Früher schrieb „Zitieren" `@name: „die ersten 60 Zeichen …"`
   * ins Feld: Der Rest war damit für immer weg, der Name ließ sich nicht verlinken, und er wäre
   * eingefroren, sobald jemand sich umbenennt.
   */
  it('legt das Zitat über das Feld und lässt den eigenen Text in Ruhe', async () => {
    createComment.mockResolvedValue({ status: 201, data: createdComment })

    const wrapper = await itemWithCommentsOpen()
    const field = wrapper.find('input[type="text"]')
    await field.setValue('Sehe ich anders.')

    await replyToOldest(wrapper)?.trigger('click')
    await flushPromises()

    // Der Entwurf bleibt, wie er war — das Zitat steht daneben, nicht darin.
    expect((field.element as HTMLInputElement).value).toBe('Sehe ich anders.')

    // Und es zeigt den ganzen Kommentar mit seinem Verfasser, nicht eine Abschrift.
    const chip = draftQuote(wrapper)
    expect(chip).toBeDefined()
    expect(chip?.props('quoted')).toMatchObject({ id: 'c0', createdByUsername: 'randnotiz' })
  })

  it('schickt die Kennung mit, nicht den Text', async () => {
    createComment.mockResolvedValue({ status: 201, data: createdComment })

    const wrapper = await itemWithCommentsOpen()

    await replyToOldest(wrapper)?.trigger('click')
    await flushPromises()

    const field = wrapper.find('input[type="text"]')
    await field.setValue('Genau.')
    await field.trigger('keydown.enter')
    await flushPromises()

    expect(createComment).toHaveBeenCalledWith('s1', {
      body: 'Genau.',
      quotedCommentId: 'c0',
    })
  })

  it('lässt das Zitat wieder verwerfen', async () => {
    const wrapper = await itemWithCommentsOpen()

    await replyToOldest(wrapper)?.trigger('click')
    await flushPromises()

    await draftQuote(wrapper)?.find('button').trigger('click')
    await flushPromises()

    expect(draftQuote(wrapper)).toBeUndefined()
  })

  /** Am fertigen Kommentar steht dasselbe Zitat — dieselbe Komponente, nur ohne Kreuz. */
  it('zeigt das Zitat über dem Kommentar, der es trägt', async () => {
    const wrapper = await itemWithCommentsOpen()

    const chip = wrapper.findComponent(QuotedComment)
    expect(chip.props('quoted')).toMatchObject({ createdByUsername: 'randnotiz' })
    // Ohne Kreuz: Ein abgeschickter Kommentar lässt sein Zitat nicht mehr verwerfen.
    expect(chip.props('removable')).toBeFalsy()
  })
})

/**
 * Der Schalter für eine einzelne Meldung.
 *
 * **Der Fall, für den es ihn gibt:** „Ich kommentiere, wir schreiben kurz hin und her, dann folgen
 * 76 weitere Kommentare, die mich nicht interessieren" — dann für diese eine Meldung Ruhe, ohne
 * alle Mitteilungen abzuschalten.
 */
/** Die Glocke steht am Eintrag, nicht hinter dem Aufklapper — sie soll von Anfang an stimmen. */
function bell(wrapper: ReturnType<typeof item>) {
  return wrapper
    .findAll('button')
    .find((candidate) =>
      ['Keine Mitteilungen mehr', 'Mitteilungen einschalten'].includes(
        candidate.attributes('aria-label') ?? '',
      ),
    )
}

describe('Mitteilungen für eine Meldung', () => {
  it('zeigt an der Glocke, ob von hier etwas kommt', async () => {
    const wrapper = item('box')
    await flushPromises()

    const button = bell(wrapper)
    expect(button).toBeDefined()
    // Ein Zustand, den man sieht, statt eines Satzes, den man lesen muss.
    expect(button?.attributes('aria-pressed')).toBe('true')
    expect(button?.attributes('aria-label')).toBe('Keine Mitteilungen mehr')
  })

  it('schaltet Mitteilungen für diese Meldung ab', async () => {
    setSubscription.mockResolvedValue({ status: 200, data: {} })

    const wrapper = item('box')
    await flushPromises()

    await bell(wrapper)?.trigger('click')
    await flushPromises()

    expect(setSubscription).toHaveBeenCalledWith('s1', { subscribed: false })
  })
})

/**
 * **Der neueste Kommentar steht oben.**
 *
 * Wer eine Meldung aufklappt, will wissen, was gerade dazugekommen ist — nicht, womit ein Gespräch
 * vor drei Wochen anfing. Und weil die Liste rückwärts läuft, landen nachgeladene ältere von
 * selbst unter dem, was man gerade liest, statt sich darüberzuschieben.
 */
describe('Die Reihenfolge der Kommentare', () => {
  it('zeigt den neuesten zuerst', async () => {
    const wrapper = await itemWithCommentsOpen()

    // An den Absätzen gemessen, nicht am ganzen Text: Der zitierte Wortlaut steht sonst zweimal
    // da — einmal als Zitat, einmal als der Kommentar selbst — und die Suche fände den falschen.
    const bodies = wrapper.findAll('p.leading-5').map((paragraph) => paragraph.text())

    // Der Server liefert alt nach neu; gedreht wird beim Anzeigen.
    expect(bodies[0]).toContain(quotingComment.body)
    expect(bodies[1]).toContain('Das ist ein ziemlich langer Kommentar')
  })
})

/**
 * **Aufgeklappt wird auf Klick, auch auf der Seite.**
 *
 * Einen Moment lang standen die Stränge dort von selbst offen. Das las sich gut, bis eine Meldung
 * mit vielen Kommentaren dazwischenlag: Sie füllt dann die Seite, alle anderen gehen unter, und
 * man scrollt durch etwas, das man nicht lesen wollte.
 */
describe('Die Kommentare auf der Seite', () => {
  it('bleiben zu, bis jemand sie öffnet', async () => {
    const wrapper = item('page')
    await flushPromises()

    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
  })

  /** Eine Pille mit einer Zahl sieht aus wie eine Anzeige. Mit Wort sieht sie aus wie ein Weg. */
  it('sind über ein Wort erreichbar, nicht über eine blanke Zahl', async () => {
    const aufDerSeite = item('page')
    await flushPromises()
    expect(aufDerSeite.text()).toContain('2 Kommentare')

    // Im Kasten ist dafür kein Platz; dort hilft die Beschriftung für Vorlesegeräte.
    const imKasten = item('box')
    await flushPromises()
    expect(imKasten.text()).not.toContain('2 Kommentare')
    expect(
      imKasten
        .findAll('button')
        .some((button) => button.attributes('aria-label') === 'Kommentare anzeigen'),
    ).toBe(true)
  })
})
