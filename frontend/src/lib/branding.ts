import { getRequiredEnvVariable } from '@/lib/env'

/** Defaulted in `vite.config.ts`, so this throw only fires if that default is ever removed. */
export const APP_NAME: string = getRequiredEnvVariable(
  import.meta.env.VITE_APP_NAME,
  'VITE_APP_NAME',
)

/**
 * Where the footer sends somebody who wants the code.
 *
 * The licence is AGPL, and its network clause is the reason this exists: whoever *uses* a modified
 * instance over the network is owed the source of the version they are using. A repository that
 * exists somewhere satisfies nothing on its own — the offer has to reach the people on the page.
 *
 * So a fork points at **its own** source, not at the project it came from. Ours is a fork of
 * Calliope, and what runs here is not what runs there.
 *
 * Taken from upstream, where the same link was added on 3 September 2026. It calls the variable
 * `PUBLIC_SOURCE_URL` since its env cleanup; this fork still uses the `VITE_` prefix, so the name
 * differs and a later merge has to notice that rather than assume a conflict.
 */
export const SOURCE_URL: string = import.meta.env.VITE_SOURCE_URL
