import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { planGradePromptTexts } from '#src/agents/index.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { Effort, GradeInputs, LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
	/** Every plan path, overview included — the same list the deterministic detectors read. */
	planPaths: string[];
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

/**
 * Fingerprint everything one grading pass measures: the plan text, the code
 * beside it, the standards, the plan-relevant config, the prompts and the model.
 *
 * Each probe is its own statement, as in `readGradeStamp`, because they fail
 * independently: an unread changed-file list is left ABSENT rather than written
 * as an empty one, since "nobody looked" and "nothing changed" must never
 * compare equal. Hashing the changed files' contents rather than their names is
 * what makes a dirty tree comparable at all instead of permanently uncertain.
 */
export const getGradeInputs = async ({ cwd, planPaths, standards, config, model, effort }: Params): Promise<GradeInputs> => {
	const hashed = await Promise.all(planPaths.map(async (path) => ({ file: basename(path), sha256: await hashFile({ path }) })));
	const planFiles = hashed.sort((left, right) => (left.file > right.file ? 1 : -1));
	const gradedCommit = await readGitHeadCommit({ cwd });
	const changed = await readGitChangedFiles({ cwd });
	const measured = {
		planFiles,
		gradedCommit,
		changedFiles: changed === undefined ? undefined : await hashChangedFiles({ cwd, changed }),
		standards: standards === undefined ? undefined : sha256({ content: standards }),
		config: sha256({ content: canonicalJson({ value: planRelevantConfig({ config }) }) }),
		prompts: sha256({ content: planGradePromptTexts.join('\n') }),
		model,
		effort,
	};

	return { ...measured, sha256: sha256({ content: canonicalJson({ value: measured }) }) };
};
