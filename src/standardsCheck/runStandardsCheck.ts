import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@/common/utils/loadConfig';
import type { StandardsFinding } from '@/contracts';
import { detectStandardsChannels } from '@/standards';
import { applyStandardsBaseline } from '@/standardsCheck/common/utils/applyStandardsBaseline';
import { resolvePackageRuleStates } from '@/standardsCheck/resolvePackageRuleStates';
import { runPackageChecks } from '@/standardsCheck/runPackageChecks';
import { resolveStandardsPackages } from '@/standardsPackages';

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
 * asked to "go find problems". The rules come from the standards packages the
 * repo loads, each rule bringing its own check, so what a repo enforces and
 * what a repo is told are the same document. Severity and settings come from
 * the resolved rule states, which is what makes `lightsout standards-check
 * --list` the truthful account of what a repo enforces.
 *
 * Framework channels are detected from the root package.json, exactly as the
 * prompt side detects them: a document out of play for this repo contributes no
 * prose, so it contributes no checks either.
 *
 * Read-only apart from .lightsout/standards-check.json (the typed evidence
 * file, the refactor pipeline's work-list). Baselining is explicit, never a
 * side effect: `writeBaseline` writes lightsout.standards-baseline.json at the
 * repo root — a COMMITTED debt ledger, like phpstan-baseline.neon or detekt's
 * baseline.xml — and later runs report only findings whose site key is not in
 * it (`all` overrides).
 *
 * @throws {Error} When a declared standards package cannot be loaded, or a check misbehaves — a repo that asked for standards and did not get them must not run.
 */
export const runStandardsCheck = async ({
	cwd,
	path,
	all = false,
	writeBaseline = false,
	persist = true,
	onProgress,
}: Params): Promise<{ findings: StandardsFinding[]; notes: string[] }> => {
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const packages = await resolveStandardsPackages({ cwd, config });
	const states = resolvePackageRuleStates({ packages, config });
	// An empty package scope means the root package.json decides — the same call
	// the prompt side makes, so prose and checks never disagree about which
	// frameworks this repo is in.
	const channels = config?.standardsChannels ?? (await detectStandardsChannels({ cwd, packagesDir: config?.packagesDir ?? 'packages', packages: [] }));
	const checked = await runPackageChecks({
		cwd,
		packages,
		states,
		channels,
		packagesDir: config?.packagesDir,
		path,
		exclude: config?.generated,
		onProgress,
	});
	const findings = checked.findings;
	const notes = [...checked.notes];
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
		await writeFile(
			join(dir, 'standards-check.json'),
			`${JSON.stringify({ at: new Date().toISOString(), path: path ?? '.', findings, notes }, undefined, '\t')}\n`,
			'utf8',
		);
	}

	return { findings: baseline.reported, notes };
};
