import { basename } from 'node:path';
import { getPhaseConnections } from '#src/plan/common/scope/getPhaseConnections.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	/** Every implementable plan file with its text, in deliverable order. */
	files: DeliverableFile[];
	/** The overview's text — a phased plan's only statement of what each phase hands forward. */
	overviewText: string;
}

/** The deliverable's plan files, parsed — the same shape the lint walks, built here because the graph reads the plan text itself. */
const parseFiles = ({ files }: { files: DeliverableFile[] }): PhaseFile[] =>
	files.map((file) => {
		const base = basename(file.path);

		return { path: file.path, base, number: Number(/^phase(\d+)-/.exec(base)?.[1] ?? 1), plan: parsePlan({ content: file.text, base }) };
	});

/**
 * The phase graph, or the reason it could not be built — one function because
 * both the scope decision and the pass itself narrow against it, and a second
 * copy of the parse would be a second reach rule able to disagree with the first.
 *
 * Keeping the failure in the answer rather than throwing leaves the fallback to a
 * full review one branch at each caller rather than one per way of failing.
 */
export const getPhaseGraph = ({ files, overviewText }: Params): { connections: Map<string, Set<string>> } | { error: string } =>
	getPhaseConnections({
		phases: parseFiles({ files }),
		declarations: parsePhaseDeclarations({ plan: parsePlan({ content: overviewText, base: 'overview.md' }) }),
	});
