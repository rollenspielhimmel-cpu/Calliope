/**
 * Whether a suspension is in force *now*, which is the only question anything asks about one.
 *
 * There is no job that clears an expired suspension, and there does not need to be: the moment
 * itself decides, so a lapsed one simply stops matching here and the member signs in normally.
 * The columns stay behind on purpose — they are the record that there was one.
 *
 * Shared rather than written at each of the three refusal points, so the comparison cannot drift
 * between them and the pair can be narrowed to non-null in one place.
 */
export function isSuspended(
  user: { suspendedUntil: string | null; suspensionReason: string | null },
): { suspendedUntil: string; reason: string } | undefined {
  const { suspendedUntil, suspensionReason } = user;

  // A CHECK constraint keeps the two together, so one without the other is not a state the
  // database can hold — the second test is what narrows the type rather than a real case.
  if (suspendedUntil === null || suspensionReason === null) {
    return undefined;
  }

  if (
    Temporal.Instant.compare(
      Temporal.Instant.from(suspendedUntil),
      Temporal.Now.instant(),
    ) <= 0
  ) {
    return undefined;
  }

  return { suspendedUntil, reason: suspensionReason };
}
