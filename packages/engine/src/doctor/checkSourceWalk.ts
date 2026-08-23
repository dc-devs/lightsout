import { relative } from 'node:path';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { listSourceFiles } from '#src/common/sourceFiles/listSourceFiles.ts';
import { probeTimeoutMs } from '#src/doctor/common/constants/probeTimeoutMs.ts';
import type { DoctorCheck } from '#src/doctor/common/types/DoctorCheck.ts';

interface Params {
	cwd: string;
	/** The config's `generated` list — paths the consumer declared as output. */
	generated?: string[];
}

const sourceExtension = /\.(m|c)?[jt]sx?$/;

/**
 * Why the walk is entitled to skip a file git tracks. Anything git tracks that
 * matches none of these is the interesting case.
 *
 * `fixtures/` is only a reason inside a standards pack, so the pack roots the
 * walk found are what decides it rather than the name alone.
 */
const skipReason = ({ path, generated, standardsPacks }: { path: string; generated: string[]; standardsPacks: string[] }) => {
	const segments = path.split('/');

	if (path.endsWith('.d.ts')) {
		return 'declaration file';
	}

	if (segments.some((segment) => segment.startsWith('.'))) {
		return 'dot directory';
	}

	if (segments.includes('node_modules')) {
		return 'dependency tree';
	}

	if (generated.some((prefix) => path.startsWith(prefix.replace(/\/$/, '')))) {
		return 'declared generated';
	}

	const insidePack = standardsPacks.some((pack) => path.startsWith(`${pack}/`));

	if (insidePack && segments.includes('fixtures')) {
		return 'standards pack fixture';
	}

	// A build tool writes beside `src`, never inside it — the walk skips these
	// names by position, and so does this.
	const beforeSrc = segments.slice(0, segments.indexOf('src') === -1 ? segments.length : segments.indexOf('src'));

	return beforeSrc.some((segment) => ['dist', 'build', 'coverage', 'out'].includes(segment)) ? 'build output' : undefined;
};

/**
 * Does the walk see everything git tracks?
 *
 * The walk hid `packages/engine/src/coverage` — nineteen files — for as long as
 * it skipped every directory named `coverage`, and nothing said so: a walk that
 * lists fewer files reports fewer findings rather than an error, so the rules
 * simply had less to read. Only a count noticed.
 *
 * git's index is the second opinion. Every source file git tracks should either
 * be listed by the walk or be skipped for a reason this can name; a file that is
 * neither is the next blind spot, reported while it is one file rather than
 * nineteen.
 */
export const checkSourceWalk = async ({ cwd, generated = [] }: Params): Promise<DoctorCheck> => {
	const result = await runCommand({ command: 'git ls-files -z', cwd, timeoutMs: probeTimeoutMs }).catch(() => undefined);

	if (result === undefined || result.exitCode !== 0) {
		return { id: 'source-walk', status: 'warn', detail: 'not a git repository — the walk has no second opinion to check against' };
	}

	const tracked = (result.stdout ?? '')
		.split('\0')
		.filter((path) => path !== '' && sourceExtension.test(path))
		.map((path) => relative('.', path));

	const { files, standardsPacks } = await listSourceFiles({ cwd, exclude: generated });
	const walked = new Set(files);
	const unexplained = tracked.filter((path) => !walked.has(path) && skipReason({ path, generated, standardsPacks }) === undefined);

	if (unexplained.length === 0) {
		return { id: 'source-walk', status: 'pass', detail: `walk reads ${files.length} of ${tracked.length} tracked source file(s); every skip is accounted for` };
	}

	const shown = unexplained.slice(0, 5);

	return {
		id: 'source-walk',
		status: 'fail',
		detail: `${unexplained.length} tracked source file(s) the walk never reads: ${shown.join(', ')}${unexplained.length > shown.length ? ', …' : ''}`,
		fix: "no rule reads these — either the walk is skipping a directory it should not, or the path belongs in the config's `generated` list",
	};
};
