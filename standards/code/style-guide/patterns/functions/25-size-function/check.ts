import type ts from 'typescript';
import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@/contracts';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';
import { collectFunctionNodes } from '../../../../../common/utils/collectFunctionNodes.ts';

/** One function measured over the cap its name earned, in the words the finding reports it. */
interface Oversized {
	kind: string;
	name: string;
	lines: number;
	cap: number;
	startLine: number;
	endLine: number;
}

/**
 * The cap a function owes and the word for what it is. The name decides first —
 * a `use`-prefixed function is a hook wherever it lives — then the file: a
 * capitalized function in a `.tsx` is a component. Everything else is a plain
 * function on the table's own cap.
 */
const getSizeCap = ({ name, path, settings }: { name: string; path: string; settings: Record<string, number> }) => {
	let sized = { cap: settings.function, kind: 'function' };

	if (/^use[A-Z]/.test(name)) {
		sized = { cap: settings.hook, kind: 'hook' };
	} else if (path.endsWith('.tsx') && /^[A-Z]/.test(name)) {
		sized = { cap: settings.component, kind: 'component' };
	}

	return sized;
};

/**
 * Every function in one file that runs past its cap.
 *
 * Nested function-likes are walked too, but a callback nobody named inherits its
 * parent's budget rather than earning one of its own — the parent is the
 * function anyone would split.
 */
const getOversized = ({
	path,
	sourceFile,
	compiler,
	settings,
}: {
	path: string;
	sourceFile: ts.SourceFile;
	compiler: typeof ts;
	settings: Record<string, number>;
}) => {
	const found: Oversized[] = [];

	for (const { name, startLine, endLine } of collectFunctionNodes({ sourceFile, compiler })) {
		const { cap, kind } = getSizeCap({ name, path, settings });
		const lines = endLine - startLine + 1;

		if (lines > cap && name !== '(anonymous)') {
			found.push({ kind, name, lines, cap, startLine, endLine });
		}
	}

	return found;
};

/**
 * One finding per file: the work is "open this file and extract", which does not
 * become three jobs because three functions in it are long.
 */
const buildFileFindings = ({ input, settings }: { input: SyntaxTreeInput; settings: Record<string, number> }) => {
	const findings: RawStandardsFinding[] = [];

	for (const [path, sourceFile] of input.trees) {
		const oversized = getOversized({ path, sourceFile, compiler: input.compiler, settings });

		if (oversized.length > 0) {
			findings.push(
				buildRawFinding({
					rule: 'size-function',
					files: oversized.map(({ startLine, endLine }) => ({ path, startLine, endLine })),
					detail: oversized.map(({ kind, name, lines, cap }) => `${kind} '${name}' is ${lines} lines (cap ~${cap})`).join('; '),
					guidance: 'Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.',
				}),
			);
		}
	}

	return findings;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	// Measured from the tree rather than counted off the text: the table measures
	// a function from its signature to its closing brace, and only the parse says
	// where either of those is.
	run: ({ input, settings }): RawStandardsFinding[] => (input.kind === 'syntax-tree' ? buildFileFindings({ input, settings }) : []),
};
