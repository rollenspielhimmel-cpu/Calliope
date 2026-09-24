import { computed } from 'vue'
import { useInfiniteQuery, useQueryClient } from '@tanstack/vue-query'
import {
  getListStatusUpdatesQueryKey,
  listStatusUpdates,
} from '@/api/status-updates/status-updates'
import { listKeyPrefix } from '@/lib/api/queryKeys'
import type { ListStatusUpdates200ResultsItem } from '@/api/models'

/**
 * Die Statusmeldungen, seitenweise rückwärts über einen Zeiger.
 *
 * **Von Hand statt erzeugt**, aus demselben Grund wie bei den Chat-Nachrichten: Orvals
 * `useInfinite` setzt einen *Abfrageparameter* ein, und diese Endpunkte tragen ihre Blätterei im
 * Rumpf. Der Schlüssel kommt trotzdem aus `getListStatusUpdatesQueryKey`, damit eine Auffrischung,
 * die gegen den erzeugten Schlüssel geschrieben ist, auch diese Abfrage erreicht.
 *
 * **Die Seitengröße gehört dem Aufrufer.** Der Kasten auf der Startseite ist ein Blick und holt
 * zehn; die eigene Seite ist ein Archiv und holt mehr. Zwei Größen heißen zwei Einträge im
 * Zwischenspeicher — gewollt: Der Kasten soll nicht plötzlich hundert Meldungen halten, weil
 * jemand nebenan lange geblättert hat.
 */
export function useStatusUpdates(pageSize: number) {
  const query = useInfiniteQuery({
    // Im Rumpf-Fach steht nur die Seitengröße; der Zeiger lebt in den Seitenparametern, sonst
    // wäre jede Seite ein eigener Eintrag im Zwischenspeicher.
    queryKey: getListStatusUpdatesQueryKey({ limit: pageSize }),
    queryFn: ({ pageParam }) =>
      listStatusUpdates({ limit: pageSize, before: pageParam ?? undefined }),
    initialPageParam: undefined as string | undefined,
    // Null heißt: Die erste Meldung ist erreicht.
    getNextPageParam: (lastPage) =>
      lastPage.status === 200 ? (lastPage.data.nextCursor ?? undefined) : undefined,
  })

  /** Alle Seiten hintereinander. Jede Seite ist neueste zuerst, und die Seiten laufen rückwärts. */
  const updates = computed<ListStatusUpdates200ResultsItem[]>(() =>
    (query.data.value?.pages ?? []).flatMap((page) =>
      page.status === 200 ? page.data.results : [],
    ),
  )

  return {
    updates,
    isPending: query.isPending,
    isError: query.isError,
    hasOlder: query.hasNextPage,
    isLoadingOlder: query.isFetchingNextPage,
    loadOlder: query.fetchNextPage,
  }
}

/**
 * Sagt beiden Listen, dass sie veraltet sind — dem Kasten und der Seite.
 *
 * `listKeyPrefix` schneidet das Rumpf-Fach ab, in dem die Seitengröße steht. Ohne das träfe eine
 * Auffrischung nur die Liste mit genau dieser Größe, und die andere zeigte weiter den alten Stand:
 * Wer auf der Startseite kommentiert und dann die Seite öffnet, sähe dort die alte Zahl.
 */
export function useRefreshStatusUpdates(): () => Promise<void> {
  const queryClient = useQueryClient()

  return async () => {
    await queryClient.invalidateQueries({
      queryKey: listKeyPrefix(getListStatusUpdatesQueryKey()),
    })
  }
}
