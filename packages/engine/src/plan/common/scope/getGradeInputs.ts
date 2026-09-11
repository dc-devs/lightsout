import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { planGradePromptTexts } from '#src/agents/index.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { DecisionRow, Effort, GradeInputs, LightsoutConfig } from '#src/contracts/index.ts';
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

/**
 * The decision-log part of a phased plan's fingerprint, or `undefined` for a
 * single plan and for an overview that could not be read — never a hash of
 * content nobody read.
 *
 * The overview is hashed with the span `parsePlan` locates as the Decision Log
 * removed. That span is safe to leave out because the blocking log-matches-record
 * check stops the pass before this runs, and the rows it was rendered from are
 * fingerprinted one by one beside it.
 */
const readDecisionLog = async ({ planPaths, decisions }: { planPaths: string[]; decisions: DecisionRow[] }) => {
	const overviewPath = planPaths.find((path) => basename(path) === 'overview.md');
	const text = overviewPath === undefined ? undefined : await readFile(overviewPath, 'utf8').catch(() => undefined);

	if (text === undefined) {
		return undefined;
	}

	const plan = parsePlan({ content: text, base: 'overview.md' });
	const range = plan.decisionLogRange;
	const design = range === undefined ? plan.lines : [...plan.lines.slice(0, range.start - 1), ...plan.lines.slice(range.end)];

	return { overview: sha256({ content: design.join('\n') }), rows: decisions.map((row) => toDecisionEntry({ row })) };
};

/**
 * Fingerprint everything one grading pass measures: the plan text, the code
 * beside it, the standards, the plan-relevant config, the prompts, the model
 * and, for a phased plan, the decision rows its overview's log is rendered from.
 *
 * Each probe is its own statement, as in `readGradeStamp`, because they fail
 * independently: an unread changed-file list is left ABSENT rather than written
 * as an empty one, since "nobody looked" and "nothing changed" must never
 * compare equal. Hashing the changed files' contents rather than their names is
 * what makes a dirty tree comparable at all instead of permanently uncertain.
 */
export const getGradeInputs = async ({ cwd, planPaths, decisions, standards, config, model, effort }: Params): Promise<GradeInputs> => {
	const hashed = await Promise.all(planPaths.map(async (path) => ({ file: basename(path), sha256: await hashFile({ path }) })));
	const planFiles = hashed.sort((left, right) => (left.file > right.file ? 1 : -1));
	const gradedCommit = await readGitHeadCommit({ cwd });
	const changed = await readGitChangedFiles({ cwd });
	const decisionLog = await readDecisionLog({ planPaths, decisions });
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
