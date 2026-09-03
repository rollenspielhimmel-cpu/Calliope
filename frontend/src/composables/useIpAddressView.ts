import { useLocalStorage } from '@vueuse/core'

/**
 * Whether the IP history is shown on member profiles. Module-level rather than per-caller for the
 * same reason `useTheme` is: it is one switch for the whole application, so two callers reading
 * different values would be a bug rather than a feature.
 *
 * **Only the addresses.** The watchlist and the warnings are ordinary moderation and are always
 * there for somebody who may see them; an address is personal data about where a member sits, so
 * it is looked up deliberately rather than carried around on every profile that happens to open.
 *
 * A visibility preference, never a permission: somebody without a platform role sees nothing
 * whatever this holds, because the panel checks the role itself and the API refuses independently.
 */
const ipAddressViewEnabled = useLocalStorage<boolean>('calliope-ip-address-view', false)

export function useIpAddressView() {
  return { enabled: ipAddressViewEnabled }
}
