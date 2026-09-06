import { createRouter, createWebHistory } from 'vue-router'
import { routes } from './routes'
import { fetchCurrentUser, forgetCurrentUser } from '@/lib/auth/session'
import { setSessionLostHandler } from '@/lib/api/queryClient'
import { assertUnreachable } from '@/lib/assertUnreachable'

declare module 'vue-router' {
  interface RouteMeta {
    /**
     * Who may open the route. One value rather than a flag per case: separate booleans let a
     * route claim to be both guests-only and open to everyone, which means nothing and which
     * nothing would catch. Omitting it means `member`, so forgetting to mark a route locks
     * it rather than exposing it.
     */
    access?: 'member' | 'guest' | 'anyone' | 'operator' | 'administrator'

    /** Set by the forum page that is itself the tree, so `ForumLayout` does not show it twice. */
    listsForumContents?: boolean
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(async (to) => {
  let user: Awaited<ReturnType<typeof fetchCurrentUser>>

  try {
    user = await fetchCurrentUser()
  } catch {
    /**
     * The check itself failed, which is not the same as there being no session — during a
     * deploy the cookie is still perfectly good. Sending somebody to the sign-in page here
     * would throw them off their page over an outage that lasts seconds, so the navigation
     * is allowed and the connection notice covers the app until the API answers again.
     *
     * Nothing is exposed by letting it through: every request the page makes needs the
     * cookie, and if it turns out there is no session the first 401 hands over to
     * `setSessionLostHandler` below.
     */
    return true
  }

  // Bound rather than switched on inline, so TypeScript narrows it to `never` in the default
  // branch and a fourth kind of access cannot be added without handling it here.
  const access = to.meta.access ?? 'member'

  // Verification is orthogonal to access: `access` asks whether there is a session, this asks
  // what state that session's account is in. An operator route needs it as much as a member
  // one — the API refuses an unverified session whatever role it holds.
  if (
    user !== undefined &&
    (access === 'member' || access === 'operator' || access === 'administrator')
  ) {
    const addressIsUnconfirmed = user.emailAddressVerifiedAt === null

    if (addressIsUnconfirmed && to.name !== 'verifyEmailAddressRequired') {
      return { name: 'verifyEmailAddressRequired' }
    }

    if (!addressIsUnconfirmed && to.name === 'verifyEmailAddressRequired') {
      return { name: 'home' }
    }
  }

  switch (access) {
    case 'member':
      // `redirect` carries where they were headed, so signing in resumes it.
      return user === undefined
        ? { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } }
        : true

    case 'guest':
      return user === undefined ? true : { name: 'home' }

    // The same shape as `operator` one level up: what changes the platform itself — who may
    // register, what the profile asks, what the pages say — rather than what happens to one
    // account. Mirrors `authorizedAsAdministrator` in the backend, which refuses independently.
    case 'administrator': {
      if (user === undefined) {
        return { name: 'login', query: { redirect: to.fullPath } }
      }
      return user.platformRole === 'administrator' ? true : { name: 'home' }
    }

    case 'operator': {
      // Signed out goes to the sign-in page like any member route; signed in without a role
      // goes home rather than to a refusal, because there is nothing there to explain to
      // somebody who was never meant to see it. The API refuses independently.
      if (user === undefined) {
        return { name: 'login', query: { redirect: to.fullPath } }
      }
      return user.platformRole === null ? { name: 'home' } : true
    }

    case 'anyone':
      return true

    default:
      return assertUnreachable(access)
  }
})

/**
 * Löst eine Sperre, die nach einem Seitenwechsel am Seitenkörper hängen geblieben ist.
 *
 * **Warum es das gibt.** Menüs und Dialoge sperren, solange sie offen sind, die Zeigereignisse
 * dahinter — `document.body` bekommt `pointer-events: none`, und beim Schließen nehmen sie es
 * wieder weg. Wird währenddessen die Seite gewechselt, kommt dieses Aufräumen durcheinander: Der
 * Eintrag im Avatar-Menü, der zur Moderation führt, navigiert in demselben Durchgang, in dem sich
 * das Menü schließt. Zurück bleibt eine Sperre, die niemandem mehr gehört — **die Oberfläche sieht
 * normal aus und reagiert auf gar nichts mehr**, bis jemand neu lädt. Genau so gemeldet: „ich
 * klicke die ganze Zeit, nichts passiert", bei Moderation und beim Impressum.
 *
 * **Warum hier und nicht an den Aufrufstellen.** Die Reihenfolge an einer einzelnen Stelle zu
 * entzerren hilft nur dieser Stelle; die nächste Menü-Zeile, die jemand hinzufügt, hat das
 * Problem wieder. Der Seitenwechsel ist die eine Stelle, durch die alle diese Wege gehen.
 *
 * **Warum es sicher ist.** Aufgeräumt wird nur, wenn wirklich nichts mehr offen ist — steht noch
 * ein Dialog oder ein Menü, gehört die Sperre ihm und bleibt. Und nur die Sperre selbst wird
 * gelöst, nichts anderes am Seitenkörper.
 *
 * Das ist eine Behandlung des Symptoms, und sie steht hier als solche. Die Ursache liegt in der
 * Dialogbibliothek; sie zu umgehen ist billiger, als jede Aufrufstelle zu bewachen — und die
 * Alternative wäre gewesen, dass die Seite gelegentlich einfriert.
 */
router.afterEach(() => {
  // Nach dem Zeichnen, sonst räumt man weg, was gerade erst gesetzt wurde.
  globalThis.requestAnimationFrame(() => {
    if (document.body.style.pointerEvents !== 'none') {
      return
    }

    const stillOpen = document.querySelector(
      '[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="alertdialog"]',
    )

    if (stillOpen === null) {
      document.body.style.removeProperty('pointer-events')
    }
  })
})

// A session that ends mid-visit returns the reader to the sign-in page, carrying where they
// were so it resumes afterwards. Which requests may legitimately answer 401 is decided in
// the query client, not here.
setSessionLostHandler(() => {
  forgetCurrentUser()
  const from = router.currentRoute.value.fullPath
  void router.replace({ name: 'login', query: from === '/' ? {} : { redirect: from } })
})

export default router
