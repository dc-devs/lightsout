import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StandardsRule, StandardsSeverity, type StandardsFinding, type StandardsPassId } from '@/contracts';
import { isTestFile } from '@/common/utils/isTestFile';
import { listSourceFiles } from '@/common/utils/listSourceFiles';
import { loadConfig } from '@/common/utils/loadConfig';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { applyStandardsBaseline } from '@/standardsCheck/common/utils/applyStandardsBaseline';
import { resolveRuleStates } from '@/standardsCheck/resolveRuleStates';
import { standardsPasses } from '@/standardsCheck/standardsPasses';
import { standardsRuleRegistry } from '@/standardsCheck/standardsRuleRegistry';

/** Deepest directory (depth ≥ 2) holding >50% of findings — a report dominated by one path should diagnose its own config gap (live case: a generated Prisma dir missing from `generated`). */
const dominantPath = ({ findings }: { findings: StandardsFinding[] }) => {
	const paths = findings.map((finding) => finding.files[0]?.path).filter((path): path is string => path !== undefined);

	if (paths.length < 20) {
		return undefined;
	}

	let prefix = '';
	let count = paths.length;

	for (;;) {
		const children = new Map<string, number>();

		for (const path of paths) {
			if (prefix && !path.startsWith(`${prefix}/`)) {
				continue;
			}

			const segment = path.slice(prefix ? prefix.length + 1 : 0).split('/')[0];

			if (segment && !segment.includes('.')) {
				children.set(segment, (children.get(segment) ?? 0) + 1);
			}
		}

		const next = [...children.entries()].sort((a, b) => b[1] - a[1])[0];

		if (!next || next[1] / paths.length <= 0.5) {
			break;
		}

		prefix = prefix ? `${prefix}/${next[0]}` : next[0];
		count = next[1];
	}

	return prefix.split('/').length >= 2 ? { dir: prefix, count, total: paths.length } : undefined;
};

/** The rules a pass owns, straight from the registry — so a rule added later cannot leave a skip note or an off-check stale. */
const rulesOf = ({ pass }: { pass: StandardsPassId }) => Object.values(StandardsRule).filter((rule) => standardsRuleRegistry[rule].pass === pass);

interface Params {
	cwd: string;
	/** Repo-relative subpath to check (default: the whole repo). */
	path?: string;
	/** Include baselined findings instead of only what's new since the baseline. */
	all?: boolean;
	/** Write/refresh lightsout.standards-baseline.json — the explicit act of accepting the current findings as existing debt. */
	writeBaseline?: boolean;
	/** Skip writing .lightsout/standards-check.json — for in-pipeline runs that must not clobber the user's standalone report. */
	persist?: boolean;
	onProgress?: (message: string) => void;
}

/**
 * The structural standards-check suite: detection is code — agents never get
 * asked to "go find problems". Every rule in `standardsRuleRegistry` is walked
 * through the pass that produces it, in tier order; a pass whose rules the repo
 * has all switched off never runs, and one whose rules all need TypeScript is
 * skipped with an honest note when none resolves. Severity comes from the
 * resolved rule states, not from the pass — which is what makes
 * `lightsout standards-check --list` the truthful account of what a repo
 * enforces.
 *
 * Read-only apart from .lightsout/standards-check.json (the typed evidence
 * file, the refactor pipeline's work-list). Baselining is explicit, never a
 * side effect: `writeBaseline` writes lightsout.standards-baseline.json at the
 * repo root — a COMMITTED debt ledger, like phpstan-baseline.neon or detekt's
 * baseline.xml — and later runs report only findings whose site key is not in
 * it (`all` overrides).
 */
export const runStandardsCheck = async ({
	cwd,
	path,
	all = false,
	writeBaseline = false,
	persist = true,
	onProgress,
}: Params): Promise<{ findings: StandardsFinding[]; notes: string[] }> => {
	const progress = onProgress ?? (() => undefined);
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const states = resolveRuleStates({ config });
	const repoFiles = await listSourceFiles({ cwd, exclude: config?.generated });
	const allFiles = repoFiles.filter((file) => !path || file.startsWith(path));
	const source = allFiles.filter((file) => !isTestFile(file));
	const tests = allFiles.filter((file) => isTestFile(file));
	const notes: string[] = [];

	progress(`checking ${source.length} source file(s) and ${tests.length} test file(s)`);

	const compiler = resolveConsumerTypescript({ cwd, packagesDir: config?.packagesDir });
	const emitted: StandardsFinding[] = [];
	const skipped: StandardsPassId[] = [];

	for (const { id, run } of standardsPasses) {
		const live = rulesOf({ pass: id }).filter((rule) => states.get(rule)?.severity !== StandardsSeverity.Off);

		if (live.length === 0) {
			progress(`${id}: off`);
			continue;
		}

		if (compiler === undefined && live.every((rule) => standardsRuleRegistry[rule].needsTypescript)) {
			skipped.push(id);
			continue;
		}

		emitted.push(...(await run({ cwd, source, tests, files: allFiles, referenceFiles: repoFiles, states, compiler })));
		progress(`${id}: done`);
	}

	if (skipped.length > 0) {
		notes.push(`${skipped.join(', ')} skipped — no typescript resolvable from the target repo`);
	}

	// Severity is applied here rather than in the passes: a pass emits its
	// rule's default and stays ignorant of config, so the repo's policy has
	// exactly one place it can be read wrong. A rule resolved to `off` drops
	// out entirely — `off` is a configuration state, never a finding.
	const findings: StandardsFinding[] = [];

	for (const finding of emitted) {
		const severity = states.get(finding.rule)?.severity;

		if (severity === StandardsSeverity.Finding || severity === StandardsSeverity.Advisory) {
			findings.push({ ...finding, severity });
		}
	}

	const dominant = dominantPath({ findings });

	if (dominant) {
		notes.push(
			`${Math.round((dominant.count / dominant.total) * 100)}% of findings (${dominant.count}/${dominant.total}) sit under ${dominant.dir}/ — if that path is generated output, add it to the config's "generated" list`,
		);
	}

	const dir = join(cwd, '.lightsout');

	await mkdir(dir, { recursive: true });

	const baseline = await applyStandardsBaseline({ cwd, path, findings, all, writeBaseline });

	notes.push(...baseline.notes);

	if (persist) {
		await writeFile(join(dir, 'standards-check.json'), `${JSON.stringify({ at: new Date().toISOString(), path: path ?? '.', findings, notes }, undefined, '\t')}\n`, 'utf8');
	}

	return { findings: baseline.reported, notes };
};
