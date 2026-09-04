import type { GetGroup200StoryStatus } from '@/api/models'

/** The three story states, in the order a story moves through them. */
export const STORY_STATUS = [
  { value: 'planning', label: 'In Planung' },
  { value: 'writing', label: 'Wird geschrieben' },
  { value: 'finished', label: 'Abgeschlossen' },
] as const satisfies ReadonlyArray<{ value: GetGroup200StoryStatus; label: string }>
