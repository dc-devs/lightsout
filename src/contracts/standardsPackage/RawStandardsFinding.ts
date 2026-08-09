import type { z } from 'zod';
import { StandardsFinding } from '@/contracts/standardsCheck';

/**
 * What a package's check emits — a `StandardsFinding` minus `rule` and
 * `severity`. Both of those are the engine's to say: the rule id comes from the
 * folder the check was loaded from, and the severity from the rule's front
 * matter under any config override. A check that could name them itself could
 * also name them wrong.
 *
 * Derived from `StandardsFinding` rather than restated, so the two shapes cannot
 * drift: every field the engine persists is a field a check may emit.
 */
export const RawStandardsFinding = StandardsFinding.omit({ rule: true, severity: true });

export type RawStandardsFinding = z.infer<typeof RawStandardsFinding>;
