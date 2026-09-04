import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface Params {
	/** The fixture repo the file is written into. */
	cwd: string;
	/** Repo-relative path, which may name directories that do not exist yet. */
	path: string;
	content: string;
}

/** Write one repo-relative file, making the directories it sits under. */
export const writeRepoFile = ({ cwd, path, content }: Params): void => {
	mkdirSync(dirname(join(cwd, path)), { recursive: true });
	writeFileSync(join(cwd, path), content);
};
