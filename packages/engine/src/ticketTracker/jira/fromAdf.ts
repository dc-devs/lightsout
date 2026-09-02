interface Params {
	value: unknown;
}

interface AdfNode {
	type: string;
	text?: unknown;
	attrs?: unknown;
	marks?: unknown;
	content?: unknown;
}

const AdfMarkType = { Strong: 'strong', Em: 'em', Code: 'code', Link: 'link' } as const;
const InlineTokenKind = { Text: 'text', Break: 'break' } as const;

type AdfMark =
	| { type: typeof AdfMarkType.Strong }
	| { type: typeof AdfMarkType.Em }
	| { type: typeof AdfMarkType.Code }
	| { type: typeof AdfMarkType.Link; href: string };
type InlineToken = { kind: typeof InlineTokenKind.Text; text: string; marks: AdfMark[] } | { kind: typeof InlineTokenKind.Break };
const readRecord = ({ value }: { value: unknown }) => {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
};
const readNode = ({ value }: { value: unknown }): AdfNode | undefined => {
	const record = readRecord({ value });
	if (record === undefined || typeof record.type !== 'string') {
		return undefined;
	}
	return { type: record.type, text: record.text, attrs: record.attrs, marks: record.marks, content: record.content };
};
const readContent = ({ node }: { node: AdfNode }) => {
	return node.content === undefined ? [] : Array.isArray(node.content) ? node.content : undefined;
};
const readMarks = ({ value }: { value: unknown }) => {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		return undefined;
	}
	const normalized: AdfMark[] = [];
	for (const candidate of value) {
		const candidateRecord = readRecord({ value: candidate });
		if (candidateRecord === undefined || typeof candidateRecord.type !== 'string') {
			continue;
		}
		if (
			(candidateRecord.type === AdfMarkType.Strong || candidateRecord.type === AdfMarkType.Em || candidateRecord.type === AdfMarkType.Code) &&
			candidateRecord.attrs === undefined
		) {
			normalized.push({ type: candidateRecord.type });
		}
		const linkAttributes = readRecord({ value: candidateRecord.attrs });
		if (candidateRecord.type === AdfMarkType.Link && typeof linkAttributes?.href === 'string' && linkAttributes.href !== '') {
			normalized.push({ type: AdfMarkType.Link, href: linkAttributes.href });
		}
	}
	const order = { strong: 0, em: 1, code: 2, link: 3 };
	const unique = normalized.filter((mark, index) => normalized.findIndex((candidate) => candidate.type === mark.type) === index);
	return unique.sort((left, right) => order[left.type] - order[right.type]);
};
const readInlineTokens = ({ values }: { values: unknown[] }): InlineToken[] | undefined => {
	const tokens: InlineToken[] = [];
	for (const value of values) {
		const node = readNode({ value });
		if (node === undefined) {
			return undefined;
		}
		if (node.type === 'text') {
			const marks = readMarks({ value: node.marks });
			if (typeof node.text !== 'string' || marks === undefined) {
				return undefined;
			}
			tokens.push({ kind: InlineTokenKind.Text, text: node.text, marks });
			continue;
		}
		if (node.type === 'hardBreak') {
			tokens.push({ kind: InlineTokenKind.Break });
			continue;
		}
		const content = readContent({ node });
		if (content === undefined) {
			return undefined;
		}
		const descendants = readInlineTokens({ values: content });
		if (descendants === undefined) {
			return undefined;
		}
		tokens.push(...descendants);
	}
	return tokens;
};
const markKey = ({ marks }: { marks: AdfMark[] }) => JSON.stringify(marks);
const coalesceTokens = ({ tokens }: { tokens: InlineToken[] }) => {
	const result: InlineToken[] = [];
	for (const token of tokens) {
		const previous = result.at(-1);
		if (
			token.kind === InlineTokenKind.Text &&
			previous?.kind === InlineTokenKind.Text &&
			markKey({ marks: previous.marks }) === markKey({ marks: token.marks })
		) {
			previous.text += token.text;
		} else {
			result.push(token);
		}
	}
	return result;
};

const escapeText = ({ text, lineStart }: { text: string; lineStart: boolean }) => {
	const escaped = text.replace(/[\\*_`[\]()]/gu, '\\$&');
	return lineStart ? escaped.replace(/^([#-]) /u, '\\$1 ').replace(/^(\d+)\. /u, '$1\\. ') : escaped;
};
const wrapMarks = ({ text, marks }: { text: string; marks: AdfMark[] }) => {
	let prefix = '';
	let suffix = '';
	for (const mark of marks) {
		if (mark.type === AdfMarkType.Strong) {
			prefix += '**';
			suffix = `**${suffix}`;
		} else if (mark.type === AdfMarkType.Em) {
			prefix += '_';
			suffix = `_${suffix}`;
		} else if (mark.type === AdfMarkType.Code) {
			prefix += '`';
			suffix = `\`${suffix}`;
		} else {
			prefix += '[';
			suffix = `](${mark.href.replaceAll('\\', '%5C').replaceAll(' ', '%20').replaceAll(')', '%29')})${suffix}`;
		}
	}
	return `${prefix}${text}${suffix}`;
};
const renderInline = ({ values }: { values: unknown[] }) => {
	const read = readInlineTokens({ values });
	if (read === undefined) {
		return undefined;
	}
	let lineStart = true;
	let markdown = '';
	for (const token of coalesceTokens({ tokens: read })) {
		if (token.kind === InlineTokenKind.Break) {
			markdown += '\n';
			lineStart = true;
		} else {
			markdown += wrapMarks({ text: escapeText({ text: token.text, lineStart }), marks: token.marks });
			lineStart = token.text.endsWith('\n');
		}
	}
	return markdown;
};
const renderList = ({ node, depth }: { node: AdfNode; depth: number }): string | undefined => {
	const items = readContent({ node });
	const attrs = readRecord({ value: node.attrs });
	const configuredOrder = attrs?.order;
	const firstOrder = typeof configuredOrder === 'number' && Number.isInteger(configuredOrder) && configuredOrder > 0 ? configuredOrder : 1;
	if (items === undefined) {
		return undefined;
	}
	const lines: string[] = [];
	for (const [index, value] of items.entries()) {
		const item = readNode({ value });
		const content = item === undefined || item.type !== 'listItem' ? undefined : readContent({ node: item });
		const first = content === undefined ? undefined : readNode({ value: content[0] });
		const firstContent = first === undefined ? [] : readContent({ node: first });
		if (content === undefined || first?.type !== 'paragraph' || firstContent === undefined) {
			return undefined;
		}
		const text = renderInline({ values: firstContent });
		if (text === undefined) {
			return undefined;
		}
		const prefix = node.type === 'orderedList' ? `${firstOrder + index}. ` : '- ';
		lines.push(`${'  '.repeat(depth)}${prefix}${text}`);
		for (const nestedValue of content.slice(1)) {
			const nested = readNode({ value: nestedValue });
			if (nested === undefined || (nested.type !== 'bulletList' && nested.type !== 'orderedList')) {
				return undefined;
			}
			const rendered = renderList({ node: nested, depth: depth + 1 });
			if (rendered === undefined) {
				return undefined;
			}
			lines.push(rendered);
		}
	}
	return lines.join('\n');
};
const renderBlock = ({ value }: { value: unknown }) => {
	const node = readNode({ value });
	if (node === undefined) {
		return undefined;
	}
	if (node.type === 'bulletList' || node.type === 'orderedList') {
		return renderList({ node, depth: 0 });
	}
	if (node.type === 'text' || node.type === 'hardBreak') {
		return renderInline({ values: [value] });
	}
	const content = readContent({ node });
	if (content === undefined) {
		return undefined;
	}
	const text = renderInline({ values: content });
	if (text === undefined) {
		return undefined;
	}
	if (node.type !== 'heading') {
		return text;
	}
	const attrs = readRecord({ value: node.attrs });
	const level = attrs?.level;
	return typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 6 ? `${'#'.repeat(level)} ${text}` : undefined;
};
export const fromAdf = ({ value }: Params): string | undefined => {
	if (value === undefined || value === null) {
		return '';
	}
	const root = readNode({ value });
	const rootRecord = readRecord({ value });
	const content = root === undefined ? undefined : readContent({ node: root });
	if (root === undefined || rootRecord?.version !== 1 || root.type !== 'doc' || content === undefined) {
		return undefined;
	}
	const blocks = content.map((block) => renderBlock({ value: block }));
	return blocks.some((block) => block === undefined) ? undefined : blocks.join('\n\n');
};
