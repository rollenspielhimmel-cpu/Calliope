import { fileURLToPath, URL } from 'node:url'

import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

/**
 * From the repository's own `.env`, so one file describes one checkout. The proxy target is the
 * one that matters: without it a second checkout proxies into the first one's database.
 */
const rootEnvironment = loadEnv('', fileURLToPath(new URL('..', import.meta.url)), '')

const BACKEND_PORT = Number(rootEnvironment.BACKEND_PORT ?? 8000)
const FRONTEND_PORT = Number(rootEnvironment.FRONTEND_PORT ?? 5173)
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`

/**
 * Into `process.env`, or the `%VITE_APP_NAME%` placeholder survives into the page as literal text.
 * The default cannot live in `frontend/.env`, which the repository ignores — so it reads the
 * same `APP_NAME` the backend does, off the repository's own root `.env`, and falls back to the
 * upstream project's name only where neither sets one.
 */
process.env.VITE_APP_NAME ||= rootEnvironment.APP_NAME ?? 'Calliope'

/**
 * Stamped by `deployment/deploy.sh` and read back off the page to prove Caddy is serving what was
 * just built. Defaulted like the name above, to the same word the compose file uses.
 */
process.env.VITE_COMMIT ||= 'unknown'

/**
 * The legal notice's two required values — see `src/lib/imprint.ts`. Defaulted inside the plugin,
 * not here: a module-scope default runs for a build too and would make the check unreachable.
 */
const REQUIRED_ENVIRONMENT = {
  VITE_WEBSITE_OPERATOR_NAME: 'Platzhalter-Vorname Platzhalter-Nachname',
  VITE_WEBSITE_OPERATOR_EMAIL_ADDRESS: 'platzhalter@e-mail-adresse.de',
  // Named in the privacy policy, which reads badly with nobody after „Wir setzen ein:".
  VITE_HOSTER_NAME: 'Platzhalter-Hoster',
} as const

/**
 * The repository this instance is built from. Defaulted to the fork rather than to upstream: an
 * instance that offered its users somebody else's source would offer them the wrong program.
 */
process.env.VITE_SOURCE_URL ||=
  rootEnvironment.SOURCE_URL ?? 'https://github.com/rollenspielhimmel-cpu/calliope'

/**
 * Whether a shared password stands in front of this deployment. Read `build.modulePreload` for
 * what it decides and why.
 *
 * **Taken from the gate's own credential**, not from a switch of its own: two settings can
 * disagree, and the way they would is the quiet one — the gate still standing while the build
 * behaves as though it were gone. `GATE_PASSWORD_HASH` is what somebody deletes to remove the
 * gate, so it is what this asks about.
 *
 * Two sources because there are two ways to build. The deploy hands `GATE_IN_FRONT` to the build
 * container, which never sees the repository's `.env`; a build in a checkout reads that file
 * directly. Both answer the same question.
 *
 * The environment is deliberately not consulted: `testing` does not mean „gated", and on the day
 * the beta opens it may briefly be `production` with the gate still up, or `staging` without it.
 */
const GATE_IN_FRONT =
  (process.env.GATE_IN_FRONT ?? rootEnvironment.GATE_PASSWORD_HASH ?? '').trim() !== ''

/**
 * No default on a *build*: an instance that cannot say what it is would claim to be production.
 * Serving defaults to development, so a checkout still runs with no setup.
 */
const ENVIRONMENTS = ['development', 'testing', 'staging', 'production']

/**
 * A plugin, because build and serve need opposite answers and `config` is where Vite says which is
 * running — early enough to still reach `import.meta.env`.
 */
function environment(): Plugin {
  return {
    name: 'calliope:environment',
    config(_config, { command }) {
      if (command !== 'build') {
        process.env.VITE_ENVIRONMENT ||= 'development'
        // Obvious placeholders, so nobody mistakes one for configuration.
        for (const [name, placeholder] of Object.entries(REQUIRED_ENVIRONMENT)) {
          process.env[name] ||= placeholder
        }
        return
      }

      const value = process.env.VITE_ENVIRONMENT
      if (value === undefined || !ENVIRONMENTS.includes(value)) {
        throw new Error(
          `VITE_ENVIRONMENT must be one of ${ENVIRONMENTS.join(', ')} to build, not ${
            value === undefined ? 'unset' : `"${value}"`
          }. It comes from ENVIRONMENT in .env.`,
        )
      }

      // A page saying "not configured" must never reach production.
      const missing = Object.keys(REQUIRED_ENVIRONMENT).filter(
        (name) => (process.env[name] ?? '').trim() === '',
      )
      if (missing.length > 0) {
        throw new Error(
          `${missing.join(' and ')} must be set to build: the legal pages cannot name ` +
            'nobody. They come from WEBSITE_OPERATOR_* and HOSTER_* in .env.',
        )
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  build: {
    /**
     * No generated preload links **while a gate stands in front of this deployment**, because
     * they fetch without credentials.
     *
     * Vite writes `<link rel="modulepreload" crossorigin>` for a route's dependencies and hands
     * them to its own helper, which decides:
     *
     *     credentials = crossOrigin === 'use-credentials' ? 'include'
     *                 : crossOrigin === 'anonymous'       ? 'omit'
     *                 :                                     'same-origin'
     *
     * Vite sets `anonymous`, so the helper picks `omit` — no password and **no cookie**. Behind
     * this deployment's gate every lazily loaded chunk therefore came back 401, and a 401 on a
     * subresource is another password prompt. Measured against a rebuilt copy of the gate: seven
     * chunks arrived without credentials, and with this line exactly one request still does — the
     * first document, which is the prompt there is supposed to be.
     *
     * The tags Vite writes into `index.html` are not affected: the browser parses those itself and
     * sends credentials for a same-origin request. Only the runtime helper omits them.
     *
     * **What it costs.** A route's dependencies are discovered when its import runs rather than
     * ahead of it, so a first visit to a page fetches in two steps instead of one. Small here —
     * the chunks are small, the origin is the same, and the connection is HTTP/2. Worth it against
     * the alternative, which was patching Vite's own helper from a build plugin and carrying that
     * patch through every update.
     *
     * **It goes when the gate goes, by itself.** Tied to a setting rather than to a comment: a
     * remark saying „remove this later" is read by nobody, and the cost lands on a few hundred
     * people on mobile data rather than on one tester.
     */
    modulePreload: !GATE_IN_FRONT,
  },
  plugins: [environment(), vue(), vueDevTools(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Strict: drifting onto a free port is how proxying into the wrong backend goes unnoticed.
    port: FRONTEND_PORT,
    strictPort: true,

    // Mirrors production's `img-src`, because an image blocked by policy is invisible until a
    // deploy. Only that directive: HMR needs inline scripts, `eval` and a websocket.
    headers: {
      'Content-Security-Policy': "img-src 'self' data: blob:",
    },

    // Same-origin like production behind Caddy: relative URLs, no CORS, and the httpOnly cookie
    // sent without configuration. One rule, because the backend serves everything under /api.
    proxy: {
      '/api': BACKEND_URL,
    },
  },
})
