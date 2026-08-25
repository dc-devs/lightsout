import type { CloneSpan, RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../common/findings/buildRawFinding.ts';
import { getSiteGroupKey } from '../../../../common/findings/getSiteGroupKey.ts';

/** Every duplicated span between one pair of files, gathered under the identity they share. */
interface ClonedPair {
	files: RawStandardsFinding['files'];
	spans: number;
	longest: number;
}

/** The longer of a span's two sides, in lines — what a reader needs to judge how much code was copied. */
const getSpanLines = ({ span }: { span: CloneSpan }) => Math.max(...span.files.map(({ startLine, endLine }) => endLine - startLine + 1));

const groupByPair = ({ spans }: { spans: CloneSpan[] }) => {
	const byPair = new Map<string, ClonedPair>();

	for (const span of spans) {
		const key = getSiteGroupKey({ files: span.files });
		const pair = byPair.get(key) ?? { files: [], spans: 0, longest: 0 };

		byPair.set(key, {
			files: [...pair.files, ...span.files],
			spans: pair.spans + 1,
			longest: Math.max(pair.longest, getSpanLines({ span })),
		});
	}

	return byPair;
};

export const check: StandardsCheckModule = {
	inputKind: 'clone-spans',
	// Every span shared by the same pair of files is ONE finding: the identity is
	// the paths, so a second copy between two files already flagged is more
	// evidence for that finding rather than another one to accept or resolve.
	run: ({ input }): RawStandardsFinding[] => {
		const spans = input.kind === 'clone-spans' ? input.spans : [];

		return [...groupByPair({ spans }).values()].map(({ files, spans: count, longest }) =>
			buildRawFinding({
				rule: 'duplicate-code-block',
				files,
				detail: `${count} duplicated block(s), the longest ${longest} lines`,
				guidance: 'The same code is written out in both files. Extract the shared block, or say why the copies have to differ.',
			}),
		);
	},
};
