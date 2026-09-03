import { assertEquals } from "@std/assert";
import { formatEntry, parseFailures } from "./run_tests.ts";

/**
 * The parser that stands between a flaky failure and knowing its name.
 *
 * Held against a recorded report rather than a hand-written one: the fixture below is what
 * `deno test --junit-path` actually wrote for a file with a pass, a failure carrying an umlaut and
 * XML-escaped brackets, and a failing step. Every one of those broke a naive parser at some point
 * while this was being written.
 *
 * Importing `run_tests.ts` runs nothing — its `if (import.meta.main)` is what keeps this file from
 * spawning a second copy of the suite.
 */

const RECORDED_REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="deno test" tests="4" failures="3" errors="0" time="0.054">
    <testsuite name="./sample_test.ts" tests="4" disabled="0" errors="0" failures="3">
        <testcase name="a passing one" classname="./sample_test.ts" time="0.001" line="3" col="6">
        </testcase>
        <testcase name="a failing one with ümlauts &amp; &lt;brackets&gt;" classname="./sample_test.ts" time="0.039" line="7" col="6">
            <failure message="Uncaught AssertionError: Values are not equal.

-   1
+   2
">AssertionError: Values are not equal.
    at assertEquals (https://jsr.io/@std/assert/1.0.19/equals.ts:67:9)</failure>
        </testcase>
        <testcase name="a step parent" classname="./sample_test.ts" time="0.003" line="11" col="6">
            <failure message="1 test step failed">1 test step failed.</failure>
        </testcase>
        <testcase name="a step parent &gt; a failing step" classname="./sample_test.ts" time="0.002" line="12" col="11">
            <failure message="Uncaught AssertionError: Values are not equal.">AssertionError</failure>
        </testcase>
    </testsuite>
</testsuites>`;

Deno.test("a passing test contributes nothing to the log", () => {
  const failures = parseFailures(RECORDED_REPORT);

  assertEquals(
    failures.some((failure) => failure.name === "a passing one"),
    false,
  );
});

Deno.test("a failure keeps its name, its file and its message", () => {
  const failures = parseFailures(RECORDED_REPORT);
  const found = failures.find((failure) =>
    failure.name.startsWith("a failing")
  );

  // Unescaped: `&amp;` and `&lt;…&gt;` in the report are what a German test name looks like once
  // it has been through XML, and a name that reads as markup is a name nobody can grep for.
  assertEquals(found?.name, "a failing one with ümlauts & <brackets>");
  assertEquals(found?.file, "./sample_test.ts");
  assertEquals(
    found?.message?.startsWith(
      "Uncaught AssertionError: Values are not equal.",
    ),
    true,
  );
});

Deno.test("a failing step is kept, and so is the test it was running in", () => {
  const names = parseFailures(RECORDED_REPORT).map((failure) => failure.name);

  // The step says what broke; the parent says which test was running when it did. Dropping the
  // parent would leave a step name with no way back to the test that owns it.
  assertEquals(names.includes("a step parent > a failing step"), true);
  assertEquals(names.includes("a step parent"), true);
});

Deno.test("a report of nothing but passes yields no entry", () => {
  const green = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="deno test" tests="1" failures="0" errors="0" time="0.01">
    <testsuite name="./green_test.ts" tests="1" disabled="0" errors="0" failures="0">
        <testcase name="it works" classname="./green_test.ts" time="0.001" line="1" col="6">
        </testcase>
    </testsuite>
</testsuites>`;

  assertEquals(parseFailures(green), []);
});

Deno.test("an <error> counts as a failure, not only a <failure>", () => {
  const errored = `<testsuites><testsuite name="./e_test.ts">
        <testcase name="it blew up" classname="./e_test.ts">
            <error message="Leaks detected.">…</error>
        </testcase>
    </testsuite></testsuites>`;

  assertEquals(parseFailures(errored).map((failure) => failure.name), [
    "it blew up",
  ]);
});

Deno.test("the entry names the file and the test on their own lines", () => {
  const entry = formatEntry("deno task test", [
    {
      name: "a thing",
      file: "./src/x_test.ts",
      message: "Values are not equal.",
    },
  ]);

  const lines = entry.split("\n");

  // `grep FAILED` has to be enough to answer "what failed", which is the whole point of the file.
  assertEquals(lines[0]?.includes("backend  deno task test"), true);
  assertEquals(lines[1], "FAILED  ./src/x_test.ts");
  assertEquals(lines[2], "        a thing");
  assertEquals(lines[3], "          Values are not equal.");
});

Deno.test("a failure with no message still gets a line", () => {
  const entry = formatEntry("deno task test", [
    { name: "a thing", file: "./src/x_test.ts" },
  ]);

  assertEquals(entry.split("\n").slice(1, 3), [
    "FAILED  ./src/x_test.ts",
    "        a thing",
  ]);
});
