import type { PhaseDeclaration } from '#src/plan/index.ts';

interface Params {
	/** Declarations as `parsePhaseDeclarations` returned them. */
	declarations: PhaseDeclaration[];
}

/**
 * Parsed phase declarations without the line provenance the parser records
 * beside them — `rowLine` and `blockRange`, which state where each span sits in
 * the overview rather than what the phase record holds.
 *
 * A test comparing a parse against a record the engine rendered, or against the
 * record it was handed, is making a claim about the record alone; the lines are
 * the fingerprint's business and pinning them here would make every such test
 * move whenever a fixture gained a heading.
 */
export const declaredRecord = ({ declarations }: Params): PhaseDeclaration[] =>
	declarations.map(({ number, file, scope, createdCount, touchedCount, creates, exports, scripts, fileBudget }) => ({
		number,
		file,
		scope,
		createdCount,
		touchedCount,
		creates,
		exports,
		scripts,
		fileBudget,
	}));
