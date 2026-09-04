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

/**
 * The same repository, narrowed to the commit this build was made from.
 *
 * § 13 owes the source of the version somebody is *using*, not the newest one. A link to a branch
 * is right only for as long as nothing is deployed after it, and the moment it stops being right is
 * exactly the moment nobody notices. A commit is what the visitor is running, and it stays true.
 *
 * `deployment/deploy.sh` stamps `GIT_COMMIT` from `git describe --always --dirty`, which is a short
 * hash and a valid path segment on GitHub — but not always. It says `unknown` when nothing stamped
 * it, and ends in `-dirty` when the checkout had uncommitted changes; neither addresses a commit
 * that anybody can fetch. In those two cases this falls back to the repository itself, which is
 * still a real offer of the source, rather than linking to a page that does not exist.
 *
 * The shape of the path is GitHub's. A fork moved elsewhere has to revisit this line.
 */
const COMMIT: string = import.meta.env.VITE_COMMIT ?? 'unknown'

const COMMIT_IS_ADDRESSABLE = /^[0-9a-f]{7,40}$/u.test(COMMIT)

export const RUNNING_SOURCE_URL: string = COMMIT_IS_ADDRESSABLE
  ? `${SOURCE_URL}/tree/${COMMIT}`
  : SOURCE_URL
