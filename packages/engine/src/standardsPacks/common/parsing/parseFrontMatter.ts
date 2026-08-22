import { parse } from 'yaml';
import { messageOf } from '#src/common/utils/messageOf.ts';

interface Params {
	text: string;
}

const frontMatterBlock = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** YAML parses to any node type; only a mapping carries declarations. */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Split a markdown file into its leading `---` front matter and the prose that
 * follows. A file with no front matter is not an error — it simply declares
 * nothing, and every field the callers read has a default.
 *
 * @param text - the whole markdown file
 * @throws {Error} When a front matter block is present but is not valid YAML.
 */
export const parseFrontMatter = ({ text }: Params): { data: Record<string, unknown>; body: string } => {
	const match = frontMatterBlock.exec(text);
	let data: Record<string, unknown> = {};
	let body = text;

	if (match?.[1] !== undefined) {
		const block = match[1];
		let parsed: unknown;

		try {
			parsed = parse(block);
		} catch (error) {
			const firstLine = block.split('\n')[0] ?? '';

			throw new Error(`front matter is not valid YAML (starting "${firstLine}"): ${messageOf({ error })}`);
		}

		data = isRecord(parsed) ? parsed : {};
		body = text.slice(match[0].length);
	}

	return { data, body };
};
