import { runInRepo } from '#tests/helpers/runInRepo.ts';

/** Everything in the working tree, committed under a fixed identity so the fixture needs no git config of its own. */
export const commitAll = ({ cwd, message }: { cwd: string; message: string }): void => {
	runInRepo({ cwd, command: 'git', args: ['add', '-A'] });
	runInRepo({ cwd, command: 'git', args: ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message] });
};
