import { join } from 'node:path';
import { getRunDir } from '#src/runState/common/paths/getRunDir.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * Where one run keeps the deterministic findings from before its first agent
 * edit: `<repo>/.lightsout/runs/<runId>/standards-baseline.json`.
 *
 * The run's own folder rather than the manifest, which is rewritten on every
 * step and must not carry thousands of findings — and rather than the
 * repo-level `.lightsout/standards-check.json`, which belongs to the user's own
 * standalone check and must never be clobbered by a run.
 *
 * Not the committed debt ledger, whose file name is nearly the same word. That
 * one is `lightsout.standards-baseline.json` at the repo root, holds site keys a
 * repository has accepted as debt, and is read by `applyStandardsBaseline`. This
 * one is a whole `StandardsSnapshot`, is gitignored, belongs to a single run,
 * and reads past that ledger on purpose — the two records mean opposite things:
 * debt already forgiven, versus the measurement that says which debt is new.
 */
export const getRunStandardsBaselinePath = ({ cwd, runId }: Params): string => {
	return join(getRunDir({ cwd, runId }), 'standards-baseline.json');
};
