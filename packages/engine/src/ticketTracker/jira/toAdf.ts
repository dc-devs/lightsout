interface Params {
	markdown: string;
}

const TextMarkType = { Strong: 'strong', Em: 'em', Code: 'code', Link: 'link' } as const;
const InlineNodeType = { Text: 'text', HardBreak: 'hardBreak' } as const;
const ListKind = { Bullet: 'bullet', Ordered: 'ordered' } as const;
const AdfNodeType = {
	Doc: 'doc',
	Paragraph: 'paragraph',
	Heading: 'heading',
	ListItem: 'listItem',
	BulletList: 'bulletList',
	OrderedList: 'orderedList',
} as const;

interface TextMark {
	type: (typeof TextMarkType)[keyof typeof TextMarkType];
	attrs?: { href: string };
}

interface TextNode {
	type: typeof InlineNodeType.Text;
	text: string;
	marks?: TextMark[];
}
type InlineNode = TextNode | { type: typeof InlineNodeType.HardBreak };
interface ListMarker {
	depth: number;
	kind: (typeof ListKind)[keyof typeof ListKind];
	ordinal?: number;
	text: string;
}
interface ParsedInlineRun {
	nodes: InlineNode[];
	nextIndex: number;
}
interface ParsedList {
	node: unknown;
	nextIndex: number;
}
const marksKey = ({ marks }: { marks: TextMark[] }) => JSON.stringify(marks);
const appendText = ({ nodes, text, marks = [] }: { nodes: InlineNode[]; text: string; marks?: TextMark[] }) => {
	if (text === '') {
		return;
	}
	const previous = nodes.at(-1);
	if (previous?.type === InlineNodeType.Text && marksKey({ marks: previous.marks ?? [] }) === marksKey({ marks })) {
		previous.text += text;
	} else {
		nodes.push(marks.length === 0 ? { type: InlineNodeType.Text, text } : { type: InlineNodeType.Text, text, marks });
	}
};
const findUnescaped = ({ text, token, start, end }: { text: string; token: string; start: number; end: number }) => {
	for (let index = start; index <= end - token.length; index += 1) {
		if (text[index] === '\\') {
			index += 1;
			continue;
		}
		if (text.startsWith(token, index)) {
			return index;
		}
	}
	return undefined;
};
const withOuterMark = ({ nodes, mark }: { nodes: InlineNode[]; mark: TextMark }) => {
	return nodes.map((node): InlineNode => (node.type === InlineNodeType.HardBreak ? node : { ...node, marks: [mark, ...(node.marks ?? [])] }));
};
const readMarkedRun = ({ text, index, end, minimumRank }: { text: string; index: number; end: number; minimumRank: number }): ParsedInlineRun | undefined => {
	const definitions = [
		{ rank: 0, opener: '**', closer: '**', mark: { type: TextMarkType.Strong } satisfies TextMark },
		{ rank: 1, opener: '_', closer: '_', mark: { type: TextMarkType.Em } satisfies TextMark },
		{ rank: 2, opener: '`', closer: '`', mark: { type: TextMarkType.Code } satisfies TextMark },
	];
	for (const definition of definitions) {
		if (definition.rank < minimumRank || !text.startsWith(definition.opener, index)) {
			continue;
		}
		const contentStart = index + definition.opener.length;
		const close = findUnescaped({ text, token: definition.closer, start: contentStart, end });
		if (close === undefined || close === contentStart) {
			continue;
		}
		const nodes = parseInlineRange({ text, start: contentStart, end: close, minimumRank: definition.rank + 1 });
		return { nodes: withOuterMark({ nodes, mark: definition.mark }), nextIndex: close + definition.closer.length };
	}
	if (minimumRank <= 3 && text[index] === '[' && (index === 0 || text[index - 1] !== '!')) {
		const middle = findUnescaped({ text, token: '](', start: index + 1, end });
		const close = middle === undefined ? undefined : findUnescaped({ text, token: ')', start: middle + 2, end });
		if (middle !== undefined && middle > index + 1 && close !== undefined && close > middle + 2) {
			try {
				const href = decodeURIComponent(text.slice(middle + 2, close));
				if (href !== '') {
					const nodes = parseInlineRange({ text, start: index + 1, end: middle, minimumRank: 4 });
					return { nodes: withOuterMark({ nodes, mark: { type: TextMarkType.Link, attrs: { href } } }), nextIndex: close + 1 };
				}
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
};
const parseInlineRange = ({ text, start, end, minimumRank }: { text: string; start: number; end: number; minimumRank: number }): InlineNode[] => {
	const nodes: InlineNode[] = [];
	let index = start;
	while (index < end) {
		if (text[index] === '\\' && index + 1 < end) {
			appendText({ nodes, text: text[index + 1] ?? '' });
			index += 2;
			continue;
		}
		const marked = readMarkedRun({ text, index, end, minimumRank });
		if (marked !== undefined) {
			for (const node of marked.nodes) {
				if (node.type === InlineNodeType.HardBreak) {
					nodes.push(node);
				} else {
					appendText({ nodes, text: node.text, marks: node.marks });
				}
			}
			index = marked.nextIndex;
			continue;
		}
		appendText({ nodes, text: text[index] ?? '' });
		index += 1;
	}
	return nodes;
};
const parseInline = ({ text }: { text: string }) => parseInlineRange({ text, start: 0, end: text.length, minimumRank: 0 });
const paragraph = ({ text, literal = false }: { text: string; literal?: boolean }) => {
	const content: InlineNode[] = [];
	for (const [index, line] of text.split('\n').entries()) {
		if (index > 0) {
			content.push({ type: InlineNodeType.HardBreak });
		}
		const nodes = literal ? parseInlineRange({ text: line, start: 0, end: line.length, minimumRank: 4 }) : parseInline({ text: line });
		for (const node of nodes) {
			if (node.type === InlineNodeType.HardBreak) {
				content.push(node);
			} else {
				appendText({ nodes: content, text: node.text, marks: node.marks });
			}
		}
	}
	return { type: AdfNodeType.Paragraph, content };
};
const readListMarker = ({ line }: { line: string }) => {
	const match = /^( *)(?:(- )|(\d+)\. )(.*)$/u.exec(line);
	if (match === null || (match[1]?.length ?? 0) % 2 !== 0) {
		return undefined;
	}
	const ordinal = match[3] === undefined ? undefined : Number(match[3]);
	if (ordinal !== undefined && (!Number.isInteger(ordinal) || ordinal < 1)) {
		return undefined;
	}
	return {
		depth: (match[1]?.length ?? 0) / 2,
		kind: match[2] === undefined ? ListKind.Ordered : ListKind.Bullet,
		ordinal,
		text: match[4] ?? '',
	} satisfies ListMarker;
};

const parseList = ({ lines, start, depth, kind }: { lines: string[]; start: number; depth: number; kind: ListMarker['kind'] }): ParsedList | undefined => {
	const content: unknown[] = [];
	const first = readListMarker({ line: lines[start] ?? '' });
	let expectedOrdinal = first?.ordinal;
	let index = start;
	if (first === undefined || first.depth !== depth || first.kind !== kind || (kind === ListKind.Ordered && expectedOrdinal === undefined)) {
		return undefined;
	}
	while (index < lines.length) {
		const marker = readListMarker({ line: lines[index] ?? '' });
		if (marker === undefined || marker.depth !== depth || marker.kind !== kind) {
			break;
		}
		if (kind === ListKind.Ordered && marker.ordinal !== expectedOrdinal) {
			return undefined;
		}
		const itemContent: unknown[] = [paragraph({ text: marker.text })];
		index += 1;
		expectedOrdinal = expectedOrdinal === undefined ? undefined : expectedOrdinal + 1;
		while (index < lines.length) {
			const childMarker = readListMarker({ line: lines[index] ?? '' });
			if (childMarker === undefined || childMarker.depth <= depth) {
				break;
			}
			if (childMarker.depth !== depth + 1) {
				return undefined;
			}
			const child = parseList({ lines, start: index, depth: depth + 1, kind: childMarker.kind });
			if (child === undefined) {
				return undefined;
			}
			itemContent.push(child.node);
			index = child.nextIndex;
		}
		content.push({ type: AdfNodeType.ListItem, content: itemContent });
	}
	const node =
		kind === ListKind.Ordered ? { type: AdfNodeType.OrderedList, attrs: { order: first.ordinal }, content } : { type: AdfNodeType.BulletList, content };
	return { node, nextIndex: index };
};
const parseBlock = ({ block }: { block: string }) => {
	const heading = /^(#{1,6}) (.*)$/su.exec(block);
	if (heading !== null && !heading[2]?.includes('\n')) {
		return { type: AdfNodeType.Heading, attrs: { level: heading[1]?.length }, content: parseInline({ text: heading[2] ?? '' }) };
	}
	const lines = block.split('\n');
	const unsupported =
		/!\[[^\]]*\]\([^)]*\)/u.test(block) ||
		/^\s*>/mu.test(block) ||
		/^\s*<[^>]+>/mu.test(block) ||
		lines.some((line) => /^\s*\|?[\s:-]+\|[\s|:-]*$/u.test(line));
	if (unsupported) {
		return paragraph({ text: block, literal: true });
	}
	const firstMarker = readListMarker({ line: lines[0] ?? '' });
	if (firstMarker !== undefined && firstMarker.depth === 0) {
		const list = parseList({ lines, start: 0, depth: 0, kind: firstMarker.kind });
		if (list !== undefined && list.nextIndex === lines.length) {
			return list.node;
		}
	}
	return paragraph({ text: block });
};
export const toAdf = ({ markdown }: Params): { type: typeof AdfNodeType.Doc; version: 1; content: unknown[] } => {
	if (markdown === '') {
		return { type: AdfNodeType.Doc, version: 1, content: [] };
	}
	return {
		type: AdfNodeType.Doc,
		version: 1,
		content: markdown
			.split(/\n{2,}/u)
			.filter((block) => block !== '')
			.map((block) => parseBlock({ block })),
	};
};
