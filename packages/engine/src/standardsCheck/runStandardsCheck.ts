import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { excludedSourcePaths } from '#src/common/sourceFiles/excludedSourcePaths.ts';
import type { StandardsFinding } from '#src/contracts/index.ts';
import { detectStandardsChannels } from '#src/standards/index.ts';
import { applyStandardsBaseline } from '#src/standardsCheck/applyStandardsBaseline.ts';
import { buildDominantPathNote } from '#src/standardsCheck/buildDominantPathNote.ts';
import { resolvePackageRuleStates } from '#src/standardsCheck/resolvePackageRuleStates.ts';
import { runPackageChecks } from '#src/standardsCheck/runPackageChecks.ts';
import { writeStandardsSnapshot } from '#src/standardsCheck/writeStandardsSnapshot.ts';
import { resolveStandardsPacks } from '#src/standardsPacks/index.ts';

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
 * asked to "go find problems". The rules come from the standards packs the
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
 * @throws {Error} When a declared standards pack cannot be loaded, or a check misbehaves — a repo that asked for standards and did not get them must not run.
 */
export const runStandardsCheck = async ({
	cwd,
	path,
	all = false,
	writeBaseline = false,
	persist = true,
	onProgress,
}: Params): Promise<{ findings: StandardsFinding[]; notes: string[] }> => {
	const config = await readOptionalConfig({ cwd });
	const packs = await resolveStandardsPacks({ cwd, config });
	const states = resolvePackageRuleStates({ packs, config });
	// An empty package scope means the root package.json decides — the same call
	// the prompt side makes, so prose and checks never disagree about which
	// frameworks this repo is in.
	const channels =
		config?.['standards-channels'] ?? (await detectStandardsChannels({ cwd, packagesDir: config?.['packages-dir'] ?? 'packages', packages: [] }));
	const checked = await runPackageChecks({
		cwd,
		packs,
		states,
		channels,
		packagesDir: config?.['packages-dir'],
		path,
		exclude: excludedSourcePaths({ config }),
		onProgress,
	});
	const findings = checked.findings;
	const notes = [...checked.notes];
	const dominantNote = buildDominantPathNote({ findings });

	if (dominantNote !== undefined) {
		notes.push(dominantNote);
	}

	const baseline = await applyStandardsBaseline({ cwd, path, findings, all, writeBaseline });

	notes.push(...baseline.notes);

	if (persist) {
		await writeStandardsSnapshot({ cwd, snapshot: { at: new Date().toISOString(), path: path ?? '.', findings, notes } });
	}

	return { findings: baseline.reported, notes };
};
