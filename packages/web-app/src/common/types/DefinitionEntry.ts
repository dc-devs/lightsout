import type { ReactNode } from 'react';

/**
 * One term-and-value row of a `DefinitionList`.
 *
 * Named rather than restated at each call site: two callers build these rows
 * and both have to name the shape to type the function that returns them, so a
 * hand-copied tuple would be a second contract that drifts the moment the list
 * accepts a richer row.
 */
export type DefinitionEntry = [string, ReactNode];
