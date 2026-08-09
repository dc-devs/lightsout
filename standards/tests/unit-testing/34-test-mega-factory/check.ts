import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildLineSites } from '../../../common/utils/buildLineSites.ts';
import { buildRawFinding } from '../../../common/utils/buildRawFinding.ts';
import { getLineNumber } from '../../../common/utils/getLineNumber.ts';
import { readTestFiles } from '../../../common/utils/readTestFiles.ts';

// Only a FLAT destructured parameter list is measured: a nested object in a
// default value takes the pattern past `[^{}]*` and the factory goes unjudged.
// Failing closed is right for an advisory cap — a miscounted number would read
// as a measurement while being a guess.
const setupFactory = /\bconst\s+(setup[A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?\(\s*\{([^{}]*)\}/g;

/** Properties a destructured parameter list declares — split on the commas sitting outside every bracket. */
const declaredProperties = ({ inner }: { inner: string }) => {
	const parts: string[] = [];
	let depth = 0;
	let current = '';

	for (const char of inner) {
		depth += '(['.includes(char) ? 1 : ')]'.includes(char) ? -1 : 0;

		if (char === ',' && depth === 0) {
			parts.push(current);
			current = '';
			continue;
		}

		current += char;
	}

	return [...parts, current].filter((part) => part.trim() !== '');
};

// The cap is the prose's judgment made countable, and a repo may retune it
// through the rule's settings.
const megaFactoryFindings = ({ file, text, maxParams }: { file: string; text: string; maxParams: number }) => {
	const sprawling: Array<{ name: string; count: number; startLine: number; endLine: number }> = [];

	for (const match of text.matchAll(setupFactory)) {
		const properties = declaredProperties({ inner: match[2] });

		if (properties.length > maxParams) {
			sprawling.push({
				name: match[1],
				count: properties.length,
				startLine: getLineNumber({ text, index: match.index }),
				endLine: getLineNumber({ text, index: match.index + match[0].length }),
			});
		}
	}

	return sprawling.length === 0
		? []
		: [
				buildRawFinding({
					rule: 'test-mega-factory',
					files: buildLineSites({ file, spans: sprawling }),
					detail: `${sprawling.map((factory) => `'${factory.name}' takes ${factory.count} parameters (line ${factory.startLine})`).join(', ')}, over the cap of ${maxParams}`,
					guidance: 'A substantially different arrangement gets a second named factory. Heuristic — judge before acting.',
				}),
			];
};

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	run: ({ input, settings }): RawStandardsFinding[] =>
		readTestFiles({ input }).flatMap(({ file, text }) => megaFactoryFindings({ file, text, maxParams: settings.maxParams })),
};
