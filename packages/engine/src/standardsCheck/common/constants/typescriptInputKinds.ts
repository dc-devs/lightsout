import { StandardsInputKind } from '#src/contracts/index.ts';

/**
 * The input kinds the engine cannot build without a TypeScript compiler. The
 * engine borrows the consumer's rather than bundling its own, so a JS-only repo
 * has none — and the rules that asked for these inputs sit that run out with a
 * note naming them, exactly as the pass runner has always degraded.
 */
export const typescriptInputKinds: ReadonlySet<StandardsInputKind> = new Set([
	StandardsInputKind.SyntaxTree,
	StandardsInputKind.TypeChecker,
	StandardsInputKind.ImportGraph,
]);
