import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import { type LightsoutConfig, type PlanFacts, type SourceEvidenceEntry, SourceEvidenceIndex, SourceEvidenceKind } from '#src/contracts/index.ts';
import { wholeFileEvidenceLimit } from '#src/plan/evidence/common/constants/wholeFileEvidenceLimit.ts';
import { extractSourceEvidence } from '#src/plan/evidence/extractSourceEvidence.ts';
import { sourceEvidencePath } from '#src/plan/evidence/sourceEvidencePath.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	facts?: PlanFacts;
	/** Explicit acquisitions extend the shared byte cache without repository discovery. */
	targets?: Array<{ path: string; role: string }>;
	/** When supplied, these observed bytes are authoritative; missing map entries are invalid input. */
	sourceBytes?: ReadonlyMap<string, string>;
	/** Absent = defaults; supplies `packages-dir` for the compiler resolution. */
	config?: LightsoutConfig;
}

/**
 * An integration point's `at` reduced to its path half — the text before a
 * trailing `:line` or `:line:column`, and the whole string when there is no such
 * suffix.
 */
const atPath = ({ at }: { at: string }) => at.replace(/:\d+(?::\d+)?$/, '');

/**
 * Every path the verified facts recorded, with the facts' own words for why each
 * one matters, de-duplicated and in first-seen order. Nothing is discovered
 * here: the explorer already wrote down which files matter, and re-walking the
 * repository would be the discovery this module exists to stop paying for.
 */
const wantedPaths = ({ facts }: { facts: PlanFacts }) => {
	const wanted = new Map<string, string[]>();
	const record = ({ path, role }: { path: string; role: string }) => {
		const roles = wanted.get(path) ?? [];

		wanted.set(path, roles.includes(role) ? roles : [...roles, role]);
	};

	for (const area of facts.areas) {
		for (const { path, role } of area.filesToModify) {
			record({ path, role });
		}

		for (const { path, takeaway } of area.patternsToMirror) {
			record({ path, role: takeaway });
		}

		for (const { name, signature, at } of area.integrationPoints) {
			record({ path: atPath({ at }), role: `integration point: ${name} — ${signature}` });
		}
	}

	return wanted;
};

/** One path's evidence, taken from the bytes now on disk. */
const collectEntry = ({
	path,
	content,
	hash,
	roles,
	compiler,
}: {
	path: string;
	content: string;
	hash: string;
	roles: string[];
	compiler: ReturnType<typeof resolveConsumerTypescript>;
}): SourceEvidenceEntry => {
	const bytes = Buffer.byteLength(content);
	const shared = { path, sha256: hash, bytes, roles };

	if (bytes <= wholeFileEvidenceLimit || compiler === undefined) {
		return { ...shared, kind: SourceEvidenceKind.Whole, text: content, definitions: [] };
	}

	const { text, definitions } = extractSourceEvidence({ path, content, compiler });

	return { ...shared, kind: SourceEvidenceKind.Definitions, text, definitions };
};

/**
 * Collect the source evidence for one plan from its verified facts, refreshing
 * whatever has changed, and persist it in the plan's own workspace.
 *
 * Reuse is decided by hash alone: an entry whose stored `sha256` equals the hash
 * of the bytes now on disk is carried through with only its roles refreshed, and
 * anything else is re-collected. A file at or under `wholeFileEvidenceLimit` is
 * stored whole; a larger one is reduced to whole definitions with the target
 * repository's own compiler, and a repository with no TypeScript resolvable
 * stores the whole file rather than a guess.
 *
 * Two things it deliberately does not do. The excluded-source-path list is not
 * applied — `excludedSourcePaths` answers "what is not this repository's
 * source" for the checks, and a facts record that names a generated or vendored
 * file named it on purpose. And a path that is not on disk is data rather than
 * an error: `verifyFacts` never checked an integration point's `at`, so the
 * record says the file was absent and the call returns normally.
 */
export const collectSourceEvidence = async ({ cwd, name, facts, config, targets, sourceBytes }: Params): Promise<SourceEvidenceIndex> => {
	if (facts === undefined && targets === undefined) throw new Error('Source evidence requires facts or explicit targets');
	const path = sourceEvidencePath({ cwd, name });
	// Unlike the grade memory, an unreadable record is discarded rather than thrown
	// on: that one holds decisions a human settled and cannot be recomputed, while
	// this holds bytes the repository still has, so collecting them again is honest.
	const previous = await readJsonFile({ path, schema: SourceEvidenceIndex });
	const stored = new Map((previous?.entries ?? []).map((entry) => [entry.path, entry]));
	const compiler = resolveConsumerTypescript({ cwd, packagesDir: config?.['packages-dir'] ?? defaultPackagesDir });
	const wanted = facts === undefined ? new Map<string, string[]>() : wantedPaths({ facts });
	for (const target of targets ?? []) wanted.set(target.path, [...new Set([...(wanted.get(target.path) ?? []), target.role])]);
	const entries: SourceEvidenceEntry[] = targets === undefined ? [] : [...stored.values()].filter((entry) => !wanted.has(entry.path));

	for (const [relative, requestedRoles] of wanted) {
		if (sourceBytes !== undefined && !sourceBytes.has(relative)) throw new Error(`Observed source bytes are missing: ${relative}`);
		const roles = targets === undefined ? requestedRoles : [...new Set([...(stored.get(relative)?.roles ?? []), ...requestedRoles])];
		const content = sourceBytes === undefined ? await readFile(join(cwd, relative), 'utf8').catch(() => undefined) : sourceBytes.get(relative);

		if (content === undefined) {
			entries.push({ path: relative, sha256: '', kind: SourceEvidenceKind.Missing, bytes: 0, text: '', roles, definitions: [] });

			continue;
		}

		const hash = sha256({ content });
		const reusable = stored.get(relative);

		entries.push(
			reusable !== undefined && reusable.sha256 === hash ? { ...reusable, roles } : collectEntry({ path: relative, content, hash, roles, compiler }),
		);
	}

	const index = SourceEvidenceIndex.parse({
		planName: name,
		...(targets === undefined ? {} : { acquisition: { version: 1, semantics: 'bytes-only', paths: [...wanted.keys()].sort() } }),
		entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
		collectedAt: new Date().toISOString(),
	});

	await writeJsonFile({ path, value: index });

	return index;
};
