import { basename } from 'node:path';
import { planSentinelTokens } from '#src/plan/common/constants/planSentinelTokens.ts';
import { isPathToken } from '#src/plan/common/paths/isPathToken.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import { getCodeSpans } from '#src/plan/common/utils/getCodeSpans.ts';
import { getPlanNamedPaths } from '#src/plan/common/utils/getPlanNamedPaths.ts';

interface Params {
	/** Every implementable plan file, parsed. */
	phases: PhaseFile[];
	/** The overview's `## Phase Declarations`, one per phase file. */
	declarations: PhaseDeclaration[];
}

/** A span that is exactly one bare identifier — no dots, hyphens, calls, type expressions or spaces. */
const isIdentifierSpan = ({ span }: { span: string }) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(span);

/**
 * A set of lines reduced to comparable tokens, by the rules `checkPhaseHandoffs`
 * already compares hand-offs with: a path span by its basename, so the same file
 * spelled repo-relative and through a package alias still matches; a bare
 * identifier verbatim; the template's `none` sentinels skipped, because a
 * declared absence is not a name; everything else ignored as prose.
 */
const comparableTokens = ({ lines }: { lines: string[] }) => {
	const tokens = new Set<string>();

	for (const line of lines) {
		for (const span of getCodeSpans({ line })) {
			if (planSentinelTokens.has(span)) {
				continue;
			}

			if (isPathToken({ token: span })) {
				tokens.add(basename(span));
			} else if (isIdentifierSpan({ span })) {
				tokens.add(span);
			}
		}
	}

	return tokens;
};

/** What one phase supplies to the others: every path it names under a file heading, its declared exports, and the tokens it hands forward. */
const providedBy = ({ phase, exports }: { phase: PhaseFile; exports: string[] }) =>
	new Set<string>([
		...getPlanNamedPaths({ plan: phase.plan }).map((path) => basename(path)),
		...exports,
		...comparableTokens({ lines: phase.plan.sections.get('What Next Plan Expects') ?? [] }),
	]);

/**
 * Which phases a repair to one phase can reach: the undirected graph joining
 * every pair where one names something the other supplies.
 *
 * A phase supplies the basename of EVERY path it names under a file heading, not
 * only the ones it creates, so two phases modifying the same existing file are
 * connected even though neither creates it — two edits to one file are coupled
 * whichever phase owns it today. It also supplies its overview-declared exports
 * and the tokens of its `## What Next Plan Expects`.
 *
 * A phase consumes every backticked span anywhere in its text. The graph is
 * undirected because a changed shared contract affects the producer and the
 * consumer alike: a directed one would leave phase 1 unaware that a repair to
 * phase 2 reaches it.
 *
 * A phase the overview does not declare returns an `error` instead of an edge
 * set. Its exports cannot be read, so its edges cannot be trusted, and narrowing
 * a re-grade against a graph known to be short would silently leave a phase
 * unchecked while reporting the pass as covering the repair.
 */
export const getPhaseConnections = ({ phases, declarations }: Params): { connections: Map<string, Set<string>> } | { error: string } => {
	const paired = phases.map((phase) => ({ phase, declaration: declarations.find((entry) => entry.file === phase.base) }));
	const undeclared = paired.filter((entry) => entry.declaration === undefined);

	if (undeclared.length > 0) {
		return {
			error: `${undeclared.map(({ phase }) => phase.base).join(', ')} has no block in the overview's '## Phase Declarations', so what it hands to the other phases cannot be read`,
		};
	}

	const provides = new Map<string, Set<string>>();
	const consumes = new Map<string, Set<string>>();

	for (const { phase, declaration } of paired) {
		provides.set(phase.base, providedBy({ phase, exports: declaration?.exports ?? [] }));
		consumes.set(phase.base, comparableTokens({ lines: phase.plan.lines }));
	}

	const connections = new Map<string, Set<string>>(phases.map((phase) => [phase.base, new Set<string>()]));

	for (const left of phases) {
		for (const right of phases) {
			const linked = left.base !== right.base && [...(consumes.get(left.base) ?? [])].some((token) => provides.get(right.base)?.has(token));

			if (linked) {
				connections.get(left.base)?.add(right.base);
				connections.get(right.base)?.add(left.base);
			}
		}
	}

	return { connections };
};
