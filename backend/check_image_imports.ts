/**
 * Was ins Abbild kommt, bindet nichts ein, was nicht hineinkommt.
 *
 * **Warum es diese Prüfung gibt:** Eine Route hieß `broadcast_test.ts`. Lokal lief alles, 883 Tests
 * grün — und der Deploy brach beim Bauen ab, weil `.dockerignore` jedes `**\/*_test.ts` weglässt und
 * die Typprüfung im Abbild das Modul nicht mehr fand. Nichts, was vor dem Deploy läuft, sah es: Hier
 * sind immer alle Dateien da.
 *
 * **Abgeleitet aus `.dockerignore`, nicht aus einer Liste hier.** Kommt dort ein Muster dazu, wird es
 * mitgeprüft, ohne dass jemand daran denken muss. Gelesen werden die Muster, die die Datei
 * tatsächlich benutzt: `**`, `*` und ein Verzeichnis mit Schrägstrich am Ende. Ein anderes bricht die
 * Prüfung laut ab, statt still nichts zu prüfen.
 *
 * **Ein Skript und kein Test.** Die Tests laufen mit den Rechten des Servers
 * (`--permission-set=calliope`), und die dürfen das Projektverzeichnis nicht lesen — schon gar nicht
 * `.env`. Dieses hier darf es, weil es nur in `validate:check` läuft, auch in der GitHub-Prüfung.
 */

const ROOT = new URL(".", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

/** Platzhalter für `**\/` beim Umbau zum regulären Ausdruck — sonst träfe ihn das `*` danach. */
const ANY_DIRECTORIES = "§§";

async function ignorePatterns(): Promise<RegExp[]> {
  const text = await Deno.readTextFile(`${ROOT}.dockerignore`);

  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((pattern) => {
      if (/[?[\]!]/.test(pattern)) {
        throw new Error(
          `.dockerignore: dieses Muster liest die Prüfung nicht: ${pattern}`,
        );
      }

      // Ein Verzeichnis: alles darunter.
      const directory = pattern.endsWith("/");
      const body = (directory ? pattern.slice(0, -1) : pattern)
        .replaceAll(".", "\\.")
        .replaceAll("**/", ANY_DIRECTORIES)
        .replaceAll("*", "[^/]*")
        .replaceAll(ANY_DIRECTORIES, "(?:.*/)?");

      return new RegExp(`^${body}${directory ? "/.*" : ""}$`);
    });
}

async function* sourceFiles(directory: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(`${ROOT}${directory}`)) {
    const path = directory === "" ? entry.name : `${directory}/${entry.name}`;

    if (
      entry.isDirectory && entry.name !== "node_modules" &&
      !entry.name.startsWith(".")
    ) {
      yield* sourceFiles(path);
    } else if (entry.isFile && path.endsWith(".ts")) {
      yield path;
    }
  }
}

/** Löst eine Einbindung zu einem Pfad relativ zur Wurzel auf, oder zu nichts, wenn sie fremd ist. */
function resolve(from: string, specifier: string): string | undefined {
  // `@/` zeigt im Backend auf die Wurzel des Projekts (`deno.jsonc`).
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }

  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return undefined;
  }

  const segments = from.split("/").slice(0, -1);

  for (const part of specifier.split("/")) {
    if (part === "..") {
      segments.pop();
    } else if (part !== ".") {
      segments.push(part);
    }
  }

  return segments.join("/");
}

const ignored = await ignorePatterns();
const isIgnored = (path: string) =>
  ignored.some((pattern) => pattern.test(path));

const violations: string[] = [];

for await (const file of sourceFiles("")) {
  if (isIgnored(file)) {
    continue;
  }

  const text = await Deno.readTextFile(`${ROOT}${file}`);

  // Statisch, als Nebenwirkung und dynamisch — alle drei landen im Modulgraphen.
  for (
    const [, specifier] of text.matchAll(
      /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g,
    )
  ) {
    const target = specifier === undefined
      ? undefined
      : resolve(file, specifier);

    if (target !== undefined && isIgnored(target)) {
      violations.push(`${file} → ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error(
    `Diese Module kommen ins Abbild, binden aber ein, was .dockerignore weglässt:\n  ${
      violations.join("\n  ")
    }`,
  );
  Deno.exit(1);
}

console.log("Nichts, was ins Abbild kommt, bindet etwas ein, was fehlt.");
