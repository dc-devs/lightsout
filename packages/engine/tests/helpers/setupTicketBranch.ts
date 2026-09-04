import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

/**
 * A ticket branch as the queue finds one: run state ignored the way a consumer
 * repo ignores it — without that, `git add -A` would sweep the run's own
 * records into the ticket's commit — and one tracked build artefact, so a test
 * can tell "restored" from "committed".
 */
export const setupTicketBranch = (): { cwd: string; runDir: string } => {
	const { cwd } = setupBranchRepo({ branch: 'lo-70-drain' });

	writeRepoFile({ cwd, path: '.gitignore', content: '.lightsout/\n' });
	writeRepoFile({ cwd, path: 'plugin/dist/cli.mjs', content: '// built on main\n' });
	execSync('git add -A && git commit -qm ignore', { cwd, stdio: 'ignore' });

	return { cwd, runDir: join(cwd, '.lightsout', 'runs', 'run-1') };
};
