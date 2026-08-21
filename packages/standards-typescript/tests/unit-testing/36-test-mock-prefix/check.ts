import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readTestFiles } from '../../../common/checkInput/readTestFiles.ts';
import { buildLineSites } from '../../../common/findings/buildLineSites.ts';
import { buildRawFinding } from '../../../common/findings/buildRawFinding.ts';
import { scanTestLines } from '../../../common/parsing/scanTestLines.ts';

/** A module-scope mock declaration: a `const` whose line starts at column 0, so no block encloses it. */
const moduleScopeMock = /^const\s+([A-Za-z0-9_$]+)\s*=\s*jest\.fn\b/;

// Only a declaration at column 0 is judged: the rule's reason is Jest hoisting
// `jest.mock()` above module variables, and a factory-local `jest.fn()` is never
// hoisted — the cleanup prose recommends exactly that, so an indented
// declaration is out of scope rather than forgiven.
const mockPrefixFindings = ({ file, text }: { file: string; text: string }) => {
	const unprefixed = scanTestLines({ text, pattern: moduleScopeMock }).filter(({ name }) => !name.startsWith('mock'));

	return unprefixed.length === 0
		? []
		: [
				buildRawFinding({
					rule: 'test-mock-prefix',
					files: buildLineSites({ file, spans: unprefixed.map(({ line }) => ({ startLine: line, endLine: line })) }),
					detail: `${unprefixed.map(({ name, line }) => `'${name}' (line ${line})`).join(', ')} declared at module scope without a 'mock' prefix`,
					guidance: 'Jest hoists `jest.mock()` above module variables — only `mock`-prefixed names are reachable inside the factory.',
				}),
			];
};

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	run: ({ input }): RawStandardsFinding[] => readTestFiles({ input }).flatMap(mockPrefixFindings),
};
