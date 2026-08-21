import type { CloneSpansInput, StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';

type Params = Partial<Omit<CloneSpansInput, 'kind'>>;

/**
 * The input a `clone-spans` check receives — the duplicate stretches the
 * engine's detector already found, as the asking rule is handed them.
 */
export const setupCloneSpansInput = ({ spans = [], ...overrides }: Params = {}): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/a/alpha.ts', 'src/b/beta.ts'],
	spans,
	...overrides,
});
