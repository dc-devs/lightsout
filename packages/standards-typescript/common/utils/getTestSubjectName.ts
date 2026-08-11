import { getBaseName } from './getBaseName.ts';

interface Params {
	/** Repo-relative path of a test file. */
	test: string;
}

/**
 * A test file's first name segment — the name of the subject it must sit
 * beside.
 *
 * Everything from the first dot on is qualifier and suffix
 * (`runPipeline.monorepo.unit.test.ts` names `runPipeline`), so the subject is
 * what precedes it.
 */
export const getTestSubjectName = ({ test }: Params): string => getBaseName({ path: test }).replace(/\..*$/, '');
