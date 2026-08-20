import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { CoverageWorklist, type PlanDocument, PlanDocumentKind, RefactorWorklist } from '#src/contracts/index.ts';

/** A JSON plan is one of the two frozen work-lists, or it is nothing a reader can render. */
const parseWorklist = ({ path, raw }: { path: string; raw: string }): PlanDocument => {
	let parsed: unknown;

	try {
		parsed = JSON.parse(raw);
	} catch {
		// Text that is not JSON answers to neither contract, so it falls through
		// to the same absence a JSON file matching neither one reads as.
		parsed = undefined;
	}

	const refactor = RefactorWorklist.safeParse(parsed);
	const coverage = CoverageWorklist.safeParse(parsed);
	let document: Omit<PlanDocument, 'path'>;

	if (refactor.success) {
		document = { kind: PlanDocumentKind.Worklist, worklist: refactor.data };
	} else if (coverage.success) {
		document = { kind: PlanDocumentKind.CoverageWorklist, coverageWorklist: coverage.data };
	} else {
		document = { kind: PlanDocumentKind.Missing };
	}

	return { path, ...document };
};

interface Params {
	cwd: string;
	path: string;
}

/**
 * A plan as a reader shows it: markdown text, a parsed frozen work-list, or a
 * recorded absence.
 *
 * A missing or unparseable file is an absence rather than an error — a plan
 * deleted after its run is a normal state the page still has to render.
 *
 * @param cwd - the repo root; nothing outside it is readable
 * @param path - repo-relative plan path, exactly as the manifest recorded it
 * @throws {Error} When the resolved path escapes the repo root — plans are read only from inside it.
 */
export const getPlanDocument = async ({ cwd, path }: Params): Promise<PlanDocument> => {
	const root = resolve(cwd);
	const absolute = resolve(root, path);

	// Compared after resolution and with a trailing separator: a raw startsWith
	// on the input would let `../<root>-extra` through, since its resolved path
	// really does begin with the root's characters.
	if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
		throw new Error(`plan path '${path}' resolves outside the repo root`);
	}

	const raw = await readFile(absolute, 'utf8').catch(() => undefined);

	if (raw === undefined) {
		return { path, kind: PlanDocumentKind.Missing };
	}

	return path.endsWith('.json') ? parseWorklist({ path, raw }) : { path, kind: PlanDocumentKind.Markdown, text: raw };
};
