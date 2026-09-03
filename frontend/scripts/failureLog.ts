import { appendFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type { Reporter, TestCase, TestModule, Vitest } from 'vitest/node'

/**
 * Appends every failing test to `test-failures.log` at the repository root, and writes nothing on
 * a green run.
 *
 * The reason this exists: a test that fails once and passes on the next run leaves nothing behind.
 * The terminal has already scrolled and the next run reports only itself, so the name of the thing
 * that failed — the one piece needed to investigate — is gone. Two flaky failures were lost that
 * way before this was written.
 *
 * Registered in `vitest.config.ts` rather than behind a flag, so it covers `npx vitest run` and
 * watch mode alike and there is nothing to remember. It runs **beside** `default`: the terminal
 * output is unchanged.
 *
 * The backend writes the same four-line shape into the same file from `run_tests.ts`. They share
 * no code — one runs in Node and one in Deno — so the shape is what has to agree, and it is simple
 * enough to keep by hand: a `───` header, then `FAILED  <file>`, the test's name, and the message
 * indented under it.
 */

const LOG_PATH = resolve(import.meta.dirname, '../../test-failures.log')
const PROJECT_ROOT = resolve(import.meta.dirname, '..')

/** Enough to recognise the failure; the full stack belongs in the terminal, not in a growing log. */
const MESSAGE_LINES = 12

type Failure = { name: string; file: string; message?: string }

function indent(message: string | undefined): string {
  if (message === undefined || message.trim() === '') return ''

  const lines = message.split('\n')
  const kept = lines.slice(0, MESSAGE_LINES)
  if (lines.length > MESSAGE_LINES) kept.push(`… ${lines.length - MESSAGE_LINES} weitere Zeilen`)

  return `\n${kept.map((line) => `          ${line}`.trimEnd()).join('\n')}`
}

export default class FailureLogReporter implements Reporter {
  private failures: Failure[] = []
  private watching = false

  onInit(vitest: Vitest) {
    // A watch-mode failure is worth logging too, but worth telling apart from a full run.
    this.watching = vitest.config.watch === true
    this.failures = []
  }

  onTestCaseResult(testCase: TestCase) {
    const result = testCase.result()
    if (result.state !== 'failed') return

    this.failures.push({
      // `fullName` joins the describes, which is what makes a name greppable back to one `it`.
      name: testCase.fullName,
      file: relative(PROJECT_ROOT, testCase.module.moduleId).replaceAll('\\', '/'),
      message: result.errors?.[0]?.message,
    })
  }

  onTestRunEnd(_modules: readonly TestModule[], unhandledErrors: readonly { message?: string }[]) {
    // An unhandled error fails a run while naming no test, so it gets an entry of its own —
    // otherwise the log would say nothing about a run that plainly went wrong.
    const entries: Failure[] = [
      ...this.failures,
      ...unhandledErrors.map((error) => ({
        name: '(an unhandled error, outside any test)',
        file: '(no module)',
        message: error.message,
      })),
    ]

    this.failures = []

    if (entries.length === 0) return

    const command = this.watching ? 'vitest (watch)' : 'vitest run'
    const header = `─── ${new Date().toISOString()}  frontend  ${command} ───`

    const blocks = entries.map(
      ({ name, file, message }) => `FAILED  ${file}\n        ${name}${indent(message)}`,
    )

    // Append, never truncate: what is in this file is everything that has ever failed here.
    appendFileSync(LOG_PATH, `${[header, ...blocks].join('\n')}\n\n`, 'utf8')
  }
}
