import { z } from 'zod';
import type { FrameworkFacts } from '#src/FrameworkFacts.ts';

/**
 * The `getFrameworkFacts` export a pack's `common/frameworks/getFrameworkFacts.ts`
 * must provide. Validated at load time because this is pack code the engine
 * imports and then calls: a missing or mistyped export has to fail where the
 * pack is named, not later inside a run.
 */
export const StandardsFrameworksModule = z.object({
	getFrameworkFacts: z.custom<(params: { dependencies: Map<string, string[]> }) => FrameworkFacts>((value) => typeof value === 'function'),
});

export type StandardsFrameworksModule = z.infer<typeof StandardsFrameworksModule>;
