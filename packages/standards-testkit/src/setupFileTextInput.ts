import type { FileTextInput, StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';

interface Params extends Partial<Omit<FileTextInput, 'kind' | 'contents'>> {
	contents?: Array<[string, string]>;
}

/**
 * The input a `file-text` check receives, built in memory.
 *
 * The pairs become the `contents` map, and both `files` and `source` default to
 * their paths — a test that says what a file contains has already said the file
 * exists, and repeating the list is how the hand-rolled copies of this drifted
 * apart from each other.
 *
 * A file listed but deliberately absent from `contents` — the case a rule about
 * unreadable files needs — is expressed by passing `files` explicitly.
 *
 * @param contents - each file and its text, as pairs — the shape a test writes by hand
 */
export const setupFileTextInput = ({ contents = [], ...overrides }: Params = {}): StandardsCheckInput => {
	const paths = contents.map(([path]) => path);

	return {
		kind: StandardsInputKind.FileText,
		cwd: '/repo',
		source: paths,
		tests: [],
		files: paths,
		referenceFiles: [],
		standardsPacks: [],
		contents: new Map(contents),
		...overrides,
	};
};
