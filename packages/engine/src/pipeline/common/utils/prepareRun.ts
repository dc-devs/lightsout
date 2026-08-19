import { messageOf } from '@/common/utils/messageOf';
import type { LightsoutConfig } from '@/contracts';
import { readPlanSources } from '@/pipeline/common/utils/readPlanSources';
import { resolvePackageScope } from '@/pipeline/common/utils/resolvePackageScope';
import type { PipelineRun } from '@/pipeline/PipelineRun';
import { type ResolvedStandards, resolveStandards } from '@/standards';

interface Params {
	run: PipelineRun;
	cwd: string;
	config: LightsoutConfig;
	/** The `--packages` flag, when the caller passed one. */
	packages?: string[];
}

interface Prepared {
	planContent: string;
	overviewContent?: string;
	standards?: string;
	testStandards?: string;
}

/**
 * Everything the steps need before the first one runs: the plan text, the
 * package scope persisted to the manifest, and the standards loaded for the
 * roles that write code.
 *
 * The order matters. Scope is settled before standards, because the bundled
 * defaults are channelled off the scoped packages' dependencies — a backend run
 * should never pay the React-docs token tax. Both come before any gate, since a
 * gate scoped to an unresolved guess proves nothing.
 *
 * Any failure here is returned rather than thrown, so the caller can record it
 * against the run and leave a truthful manifest behind.
 */
export const prepareRun = async ({ run, cwd, config, packages }: Params): Promise<Prepared | { error: string }> => {
	const manifest = run.current();
	const sources = await readPlanSources({ cwd, plan: manifest.plan, overview: manifest.overview });

	if ('error' in sources) {
		return sources;
	}

	const scope = resolvePackageScope({
		config,
		current: manifest.packages,
		packages,
		planContent: sources.planContent,
		packagesDir: config['packages-dir'] ?? 'packages',
	});

	if ('error' in scope) {
		return scope;
	}

	if (scope.scope) {
		await run.update(scope.scope);
	}

	if (run.current().packages.length > 0) {
		run.progress(`package scope: ${run.current().packages.join(', ')} (from ${run.current().packagesSource ?? 'manifest'})`);
	}

	let resolved: ResolvedStandards;

	try {
		resolved = await resolveStandards({ cwd, config, packages: run.current().packages });
	} catch (error) {
		return { error: messageOf({ error }) };
	}

	if (resolved.requested) {
		run.progress(
			`standards channels: base${resolved.channels.length > 0 ? ` + ${resolved.channels.join(' + ')}` : ''} (${resolved.configured ? 'configured' : 'detected from package dependencies'})`,
		);
	}

	return { ...sources, standards: resolved.standards, testStandards: resolved.testStandards };
};
