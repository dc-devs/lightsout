import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';
import { isBarrelFile } from '../../../../../common/paths/isBarrelFile.ts';

/**
 * Every file past the cap its extension earns.
 *
 * A barrel is exempt at any length: a barrel is a list of re-exports, and the
 * remedy the finding would ask for — split it, or graduate the concept — is
 * exactly what a module's public API cannot do. True of every spelling the
 * shared name test answers for, `index.tsx` included.
 */
const buildFileFindings = ({ input, settings }: { input: SyntaxTreeInput; settings: Record<string, number> }) => {
	const findings: RawStandardsFinding[] = [];

	for (const [path, tree] of input.trees) {
		const lineCount = tree.getFullText().split('\n').length;
		const cap = path.endsWith('.tsx') ? settings.tsxFile : settings.file;

		if (lineCount > cap && !isBarrelFile({ path })) {
			findings.push(
				buildRawFinding({
					rule: 'size-file',
					files: [{ path }],
					detail: `${lineCount} lines (cap ~${cap})`,
					guidance: 'Split the file, or graduate the concept it has grown into.',
				}),
			);
		}
	}

	return findings;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	// The line count itself needs no parse, but the rule rides along with the
	// tree the size and duplication rules already paid for, so the file is read
	// once for all of them.
	run: ({ input, settings }): RawStandardsFinding[] => (input.kind === 'syntax-tree' ? buildFileFindings({ input, settings }) : []),
};
