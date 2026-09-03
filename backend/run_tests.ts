/**
 * `deno task test`, with every failure appended to `test-failures.log` at the repository root.
 *
 * The reason this exists: a test that fails once and passes on the next run leaves nothing behind.
 * The terminal has already scrolled, the next run overwrites any report, and the name of the thing
 * that failed — the one piece needed to investigate — is gone. Two flaky failures were lost that
 * way before this was written.
 *
 * So the log is **append-only and never truncated**, and a green run writes nothing to it. What is
 * in it is everything that has ever failed here, oldest first.
 *
 * A script rather than a longer task string, because the exit code has to survive: chaining a
 * logger after `deno test` with `;` would make the task report success on a failing suite, and no
 * logging is worth that. Arguments pass through, so `deno task test src/route/forum/x_test.ts` and
 * `deno task test --filter "…"` work as they did.
 *
 * The frontend writes the same four-line shape into the same file from `scripts/failureLog.ts`.
 * They share no code — one runs in Deno and one in Node — so the shape is what has to agree, and
 * it is simple enough to keep by hand: a `───` header, then `FAILED  <file>`, the test's name, and
 * the message indented under it.
 */

/** Next to the report it is parsed from, and overwritten every run — the log is the durable half. */
const REPORT_PATH = ".test-report.xml";

/** One file for both halves of the project, so "what failed lately" is one place to look. */
const LOG_PATH = "../test-failures.log";

type TestFailure = { name: string; file: string; message?: string };

function unescapeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    // Last, or an escaped `&amp;lt;` would come back as a tag.
    .replaceAll("&amp;", "&");
}

function attribute(tag: string, name: string): string | undefined {
  // Values are XML-escaped, so a `"` inside one is `&quot;` and cannot end the match early. `s`
  // because Deno puts the whole assertion diff, newlines and all, in `message`.
  const found = tag.match(new RegExp(`\\b${name}="([^"]*)"`, "s"));
  return found === null ? undefined : unescapeXml(found[1] ?? "");
}

/**
 * Deno's JUnit writes one `<testcase>` per test *and* per step, the step named `parent > step`,
 * and gives the parent its own "1 test step failed". Both are kept: the step says what broke, the
 * parent says which test was running when it did.
 *
 * Exported for `run_tests_test.ts`, which holds this against a recorded report.
 */
export function parseFailures(xml: string): TestFailure[] {
  const failures: TestFailure[] = [];

  for (
    const match of xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)
  ) {
    const [, attributes = "", body = ""] = match;

    const failed = body.match(/<(failure|error)\b([^>]*)>/);
    if (failed === null) {
      continue;
    }

    failures.push({
      name: attribute(attributes, "name") ?? "(unnamed test)",
      file: attribute(attributes, "classname") ?? "(unknown file)",
      message: attribute(failed[2] ?? "", "message"),
    });
  }

  return failures;
}

/** The shape the frontend's reporter also writes. Kept plain so `grep FAILED` is enough. */
export function formatEntry(command: string, failures: TestFailure[]): string {
  const header = `─── ${new Date().toISOString()}  backend  ${command} ───`;

  const blocks = failures.map(({ name, file, message }) => {
    const detail = (message ?? "")
      .split("\n")
      .map((line) => `          ${line}`.trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();

    return `FAILED  ${file}\n        ${name}${
      detail === "" ? "" : `\n${detail}`
    }`;
  });

  return `${[header, ...blocks].join("\n")}\n\n`;
}

if (import.meta.main) {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "test",
      "--parallel",
      "--permission-set=calliope",
      "--env-file=../.env",
      `--junit-path=${REPORT_PATH}`,
      ...Deno.args,
    ],
    env: {
      // Nothing listens on port 1, so a test file that imports neither fixture — and so misses
      // `test/breach_check.ts` — fails open in milliseconds rather than asking a third party.
      PWNED_PASSWORDS_URL: "http://127.0.0.1:1",
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const { code } = await command.output();

  let report: string | undefined;
  try {
    report = await Deno.readTextFile(REPORT_PATH);
  } catch {
    report = undefined;
  }

  const failures = report === undefined ? [] : parseFailures(report);

  if (failures.length > 0) {
    await Deno.writeTextFile(
      LOG_PATH,
      formatEntry("deno task test", failures),
      { append: true },
    );
  } else if (code !== 0) {
    // A crash, a compile error, an interrupted run: nothing named anything, and saying that is
    // more useful than silence, which reads as "the log knows of no failure".
    await Deno.writeTextFile(
      LOG_PATH,
      `─── ${new Date().toISOString()}  backend  deno task test ───\n` +
        `FAILED  (no report)\n        the run exited ${code} without writing ${REPORT_PATH}\n\n`,
      { append: true },
    );
  }

  Deno.exit(code);
}
