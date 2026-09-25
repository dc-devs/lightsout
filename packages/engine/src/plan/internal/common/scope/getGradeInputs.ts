import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { planGradePromptTexts } from '#src/agents/common/constants/planGradePromptTexts.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { Effort } from '#src/contracts/Effort.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { DecisionRow } from '#src/contracts/plan/decisions/DecisionRow.ts';
import type { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
import { getOverviewDesignHashes } from '#src/plan/internal/common/scope/getOverviewDesignHashes.ts';
import { getPlanDesignHash } from '#src/plan/internal/common/scope/getPlanDesignHash.ts';
import type { ParsedPlan } from '#src/plan/internal/common/types/ParsedPlan.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

interface Params {
	cwd: string;
	/** Every plan path, overview included — the same list the deterministic detectors read. */
	planPaths: string[];
	/** The merged decision rows, brainstorm first, which the overview's Decision Log is rendered from. */
	decisions: DecisionRow[];
	standards?: string;
	config?: LightsoutConfig;
	model?: string;
	effort?: Effort;
}

/** One file's content hash, or the literal `absent` when it could not be read — never a real digest, so an unreadable file never compares equal to a readable one. */
const hashFile = async ({ path }: { path: string }) => {
	const content = await readFile(path).catch(() => undefined);

	return content === undefined ? 'absent' : sha256({ content });
};

/** The config keys a grading pass actually turns on — the weighing switch, the declared surfaces, the gates, the packages dir and the executor ceiling. */
const planRelevantConfig = ({ config }: { config?: LightsoutConfig }) => ({
	plan: config?.plan,
	docs: config?.docs,
	gates: config?.gates,
	'packages-dir': config?.['packages-dir'],
	'executor-file-limit': config?.['executor-file-limit'],
});

/** Every working-tree file git reported, with the hash of what it holds now — sorted by path, so two passes over the same tree encode identically. */
const hashChangedFiles = async ({ cwd, changed }: { cwd: string; changed: string[] }) =>
	Promise.all([...changed].sort().map(async (path) => ({ path, sha256: await hashFile({ path: join(cwd, path) }) })));

/** One merged row's fingerprint entry. A `Global constraint:` row reaches the whole plan, so whatever phases it names are left out of its entry. */
const toDecisionEntry = ({ row }: { row: DecisionRow }) => {
	const phases = row.question.startsWith('Global constraint:') ? undefined : row.phases;

	return {
		sha256: sha256({ content: canonicalJson({ value: row }) }),
		questionSha256: sha256({ content: row.question }),
		...(phases === undefined ? {} : { phases }),
	};
};

/** The basename every phased plan's overview carries, and the one plan file whose text some of is about another. */
const overviewBase = 'overview.md';

/**
 * One plan file as this pass read it: the bytes behind its whole-file hash and
 * the parse its design hash is taken from. A file that could not be read carries
 * the literal `absent` hash and no parse at all — never a real digest, so an
 * unread file never compares equal to a read one.
 */
const readPlanFile = async ({ path }: { path: string }) => {
	const file = basename(path);
	const content = await readFile(path).catch(() => undefined);

	return content === undefined
		? { file, sha256: 'absent' }
		: { file, sha256: sha256({ content }), plan: parsePlan({ content: content.toString('utf8'), base: file }) };
};

/**
 * The decision part of this pass's fingerprint: one entry per merged row for
 * every plan, and the overview's shared design hash when an overview was read.
 *
 * The overview's generated spans are safe to leave out of that hash because each
 * is guarded by its own blocking check — the log-matches-record check and the
 * Global Constraints currency check both stop the pass before this runs — and
 * the rows the log was rendered from are fingerprinted one by one beside it.
 */
const readDecisionPart = ({ decisions, overviewDesign }: { decisions: DecisionRow[]; overviewDesign?: string }) => ({
	...(overviewDesign === undefined ? {} : { overviewDesign }),
	rows: decisions.map((row) => toDecisionEntry({ row })),
});

/**
 * Each plan file's design hash, keyed by basename: the overview's is the text
 * every phase shares, and a phase file's takes in the overview text credited to
 * that phase. When no span of the overview can be credited, the overview is
 * treated as wholly shared and no phase is handed any of its text, which widens
 * the pass rather than crediting a phase with a span that may not be its own.
 */
const designHashesOf = ({ read }: { read: { file: string; plan?: ParsedPlan }[] }) => {
	const overview = read.find((entry) => entry.file === overviewBase)?.plan;
	const phaseFiles = read.map(({ file }) => file).filter((file) => file !== overviewBase);
	const split = overview === undefined ? undefined : getOverviewDesignHashes({ overview, phaseFiles });
	const hashes = new Map<string, string>();

	for (const { file, plan } of read) {
		if (plan === undefined) {
			continue;
		}

		const attributed = split !== undefined && !('error' in split) ? split.attributed.get(file) : undefined;

		hashes.set(file, file === overviewBase && split !== undefined ? split.shared : getPlanDesignHash({ plan, attributed }));
	}

	return hashes;
};

/**
 * Fingerprint everything one grading pass measures: the plan text both whole and
 * as a reader read it, the code beside it, the standards, the plan-relevant
 * config, the prompts, the model and the decision rows the plan's log is
 * rendered from.
 *
 * Each probe is its own statement, as in `readGradeStamp`, because they fail
 * independently: an unread changed-file list is left ABSENT rather than written
 * as an empty one, since "nobody looked" and "nothing changed" must never
 * compare equal. Hashing the changed files' contents rather than their names is
 * what makes a dirty tree comparable at all instead of permanently uncertain.
 */
export const getGradeInputs = async ({ cwd, planPaths, decisions, standards, config, model, effort }: Params): Promise<GradeInputs> => {
	const read = (await Promise.all(planPaths.map((path) => readPlanFile({ path })))).sort((left, right) => (left.file > right.file ? 1 : -1));
	const designHashes = designHashesOf({ read });
	const planFiles = read.map(({ file, sha256: fileSha256 }) => {
		const designSha256 = designHashes.get(file);

		return { file, sha256: fileSha256, ...(designSha256 === undefined ? {} : { designSha256 }) };
	});
	const gradedCommit = await readGitHeadCommit({ cwd });
	const changed = await readGitChangedFiles({ cwd });
	const decisionLog = readDecisionPart({ decisions, overviewDesign: designHashes.get(overviewBase) });
	const measured = {
		planFiles,
		gradedCommit,
		changedFiles: changed === undefined ? undefined : await hashChangedFiles({ cwd, changed }),
		standards: standards === undefined ? undefined : sha256({ content: standards }),
		config: sha256({ content: canonicalJson({ value: planRelevantConfig({ config }) }) }),
		prompts: sha256({ content: planGradePromptTexts.join('\n') }),
		model,
		effort,
		decisionLog,
	};

	return { ...measured, sha256: sha256({ content: canonicalJson({ value: measured }) }) };
};
