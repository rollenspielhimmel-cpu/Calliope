import {
  CamelCasePlugin,
  Kysely,
  type Transaction as KyselyTransaction,
} from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { DB } from "./schema.ts";
import { postgresTypes } from "./postgres_types.ts";
import { getRequiredEnvVariable } from "@/src/util/env.ts";
import { addShutdownSignalListener } from "@/src/util/shutdown_signal.ts";
import {
  type DatabaseHealth,
  probeDatabase,
} from "@/src/operations/database_health.ts";

export type Database = Kysely<DB>;
export type Transaction = KyselyTransaction<DB>;

const driver = postgres(getRequiredEnvVariable("DATABASE_URL"), {
  ssl: false,
  connection: {
    // Every query here is milliseconds' work; this only stops a runaway holding a pool slot.
    statement_timeout: 30 * 1000, // PostgreSQL expects milliseconds
  },
  // Around (cores × 2) for the six-core host, which shares them with the app, Caddy and Redis.
  max: 10,
  // Lets the pool shrink back when traffic stops, instead of holding connections open for ever.
  idle_timeout: 30,
  // Recycles connections, so none lives long enough to go stale on the network beneath it.
  max_lifetime: 60 * 30,
  types: postgresTypes,
});

async function closeDatabaseConnections(): Promise<void> {
  console.log("Closing database connection before shutdown");
  // 5 seconds is the recommended value by the library
  await driver.end({ timeout: 5 });
  console.log("Successfully closed database connection");
}

addShutdownSignalListener(closeDatabaseConnections);

const dialect = new PostgresJSDialect({
  postgres: driver,
});

/**
 * Was ein Handle kann, das nicht schreiben darf.
 *
 * **Der Schlussstein des Umbaus aus `docs/transaktions-umbau.md`.** Schreiben heißt von hier an:
 * eine Transaktion öffnen. Wer einen Schreibweg direkt am gemeinsamen Handle sucht, findet ihn
 * nicht mehr — nicht als Verabredung im Text, sondern als Fehler beim Übersetzen.
 *
 * Der Grund steht in unserer eigenen Geschichte: Ein Vorgang, der aus drei Anweisungen besteht und
 * nach der zweiten abbricht, lässt die Hälfte stehen. Das ist uns passiert, mehr als einmal, und es
 * fällt erst Wochen später auf, wenn eine Zeile ohne ihre Gegenzeile auftaucht.
 *
 * Lesen bleibt frei: Eine Abfrage ohne Schreibteil braucht keine Klammer, und jede zu verlangen
 * würde nur Rauschen erzeugen. Wer innerhalb einer Transaktion liest, reicht die `Transaction`
 * weiter — sonst sieht die Rückfrage das gerade Geschriebene noch nicht.
 */
export type WriteFreeDatabase = Omit<
  Database,
  "insertInto" | "updateTable" | "deleteFrom" | "replaceInto" | "mergeInto"
>;

const writableDb = new Kysely<DB>({
  dialect,
  plugins: [new CamelCasePlugin()],
});

export const db: WriteFreeDatabase = writableDb;

/**
 * Wer liest, nimmt das hier: das gemeinsame Handle oder eine offene Transaktion.
 *
 * Eine Lesehilfe, die innerhalb einer Transaktion aufgerufen wird, **muss** deren Handle
 * bekommen — sonst läuft die Rückfrage auf einer anderen Verbindung und sieht die Zeile nicht, die
 * gerade erst geschrieben wurde. Das hat uns beim Umbau fünfmal eine 500 gekostet.
 */
export type Executor = WriteFreeDatabase | Transaction;

export function databaseHealthCheck(): Promise<DatabaseHealth> {
  return probeDatabase("postgres", true, () => driver`SELECT true;`);
}
