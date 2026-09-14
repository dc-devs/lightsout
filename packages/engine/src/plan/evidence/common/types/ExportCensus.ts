/**
 * The repository's existing exports, bucketed by the tier-0 name comparator —
 * the key is a `getNameKey` name key, so a lookup answers "is there an existing
 * export that is this concept" in one step.
 *
 * The inner shape is spelled inline and deliberately matches `collidesWith` on
 * `PriorArtCandidate`. The two are not unified into a third named type: that
 * would make an existing local shape depend on this module for nothing more than
 * a two-field record.
 */
export type ExportCensus = Map<string, Array<{ name: string; path: string }>>;
