import { StandardsSet } from '#src/contracts/index.ts';
import type { LoadedStandardsDocument } from '#src/standardsPacks/common/types/LoadedStandardsDocument.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/common/types/LoadedStandardsPack.ts';

interface Params {
	pack: LoadedStandardsPack;
	/** Active framework channels; base documents always apply. */
	channels: string[];
}

/** Lexicographic by pack-relative path — assembly order within one channel group. Comparator shape is the caller's. */
const byPath = (left: LoadedStandardsDocument, right: LoadedStandardsDocument) => (left.path === right.path ? 0 : left.path > right.path ? 1 : -1);

/** A document as an agent reads it: a header naming where it came from, its intro, then its rules in folder order. */
const renderDocument = ({ name, document, proseById }: { name: string; document: LoadedStandardsDocument; proseById: Map<string, string> }) => {
	const parts = [document.intro, ...document.ruleIds.map((id) => proseById.get(id) ?? '')].filter((part) => part.length > 0);

	return `<!-- ${name}: ${document.path} -->\n${parts.join('\n\n')}`;
};

/**
 * Assemble a pack's documents for inlining into agent invocations — done at
 * load time, from the rule folders themselves, so there is no pre-built copy
 * anywhere that can drift from the prose it was built from.
 *
 * Base-channel documents come first, then each active channel's in the order
 * given; within a group, documents sort by their pack-relative path. A set
 * with nothing in play is absent rather than empty.
 *
 * @param pack - the loaded pack
 * @param channels - framework channels active for the repo being worked on
 */
export const buildStandardsDocuments = ({ pack, channels }: Params): { code?: string; tests?: string } => {
	const proseById = new Map<string, string>(pack.rules.map((rule) => [rule.id, rule.prose]));

	const renderSet = ({ set }: { set: StandardsSet }) => {
		const inSet = pack.documents.filter((document) => document.set === set);
		const inChannel = ({ channel }: { channel: string }) => inSet.filter((document) => document.channel === channel).sort(byPath);
		const ordered = [...inChannel({ channel: 'base' }), ...channels.flatMap((channel) => inChannel({ channel }))];

		return ordered.length === 0 ? undefined : ordered.map((document) => renderDocument({ name: pack.name, document, proseById })).join('\n\n');
	};

	const code = renderSet({ set: StandardsSet.Code });
	const tests = renderSet({ set: StandardsSet.Tests });
	const assembled: { code?: string; tests?: string } = {};

	if (code !== undefined) {
		assembled.code = code;
	}

	if (tests !== undefined) {
		assembled.tests = tests;
	}

	return assembled;
};
