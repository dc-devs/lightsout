import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../common/utils/buildRawFinding.ts';
import { isTestFile } from '../../../../common/utils/isTestFile.ts';
import { readFileTexts } from '../../../../common/utils/readFileTexts.ts';

// Only doc-comment blocks are judged: a tag written in a line comment is prose,
// not documentation any tooling reads.
//
// The tag list is the section's closed one minus its two open entries.
// `deprecated` is banned only without a migration path, which is a judgment
// about the prose beside it, and the URL form of `see` is matched separately
// because the tag itself is fine. The trailing word boundary is what keeps
// `typeParam` — a tag the elements section asks for — from reading as `type`.
//
// Written as line comments rather than a doc block on purpose: this file would
// otherwise carry the very tags it bans, and be reported by itself.
const docComment = /\/\*\*[\s\S]*?\*\//g;
const brittleTag = /@(version|since|author|type|default|readonly|private|public|protected|memberof|todo)\b/g;
const seeUrl = /@see\s[^\n]*https?:\/\//;

/** Every banned tag one file's doc comments carry, named once each however often it appears. */
const getBrittleTags = ({ text }: { text: string }) => {
	const found = new Set<string>();

	for (const [comment] of text.matchAll(docComment)) {
		for (const [tag] of comment.matchAll(brittleTag)) {
			found.add(tag);
		}

		if (seeUrl.test(comment)) {
			found.add('@see with a URL');
		}
	}

	return [...found];
};

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	// TypeScript files only. In a JavaScript file a type tag is how a type is
	// declared at all, and this document — the TypeScript documentation style
	// guide — bans it precisely because TypeScript already owns that job. Tests
	// are left out for the same reason the rest of the code standards leave them
	// to the test standards.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents, standardsPackages } = readFileTexts({ input });

		return files
			.filter((file) => /\.tsx?$/.test(file) && !isTestFile({ path: file, standardsPackages }))
			.map((file) => {
				const tags = getBrittleTags({ text: contents.get(file) ?? '' });

				return tags.length === 0
					? undefined
					: buildRawFinding({
							rule: 'brittle-doc-tags',
							files: [{ path: file }],
							detail: `${tags.join(', ')} in a doc comment`,
							guidance: 'Delete the tag — git, TypeScript and the issue tracker already own what it records.',
						});
			})
			.filter((finding): finding is RawStandardsFinding => finding !== undefined);
	},
};
