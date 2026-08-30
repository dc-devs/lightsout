import { z } from 'zod';
import { LightsoutConfig } from '#src/contracts/index.ts';
import { configKeyDescriptions } from '#src/views/common/constants/configKeyDescriptions.ts';

/**
 * The schema's fields reachable by a key spelled as a string.
 *
 * Widened at the assignment rather than cast at each use: `LightsoutConfig.shape`
 * is a generic mapped type, so indexing it with a `string` variable has no index
 * signature to satisfy.
 */
const configSchemaFields: Record<string, z.ZodType> = LightsoutConfig.shape;

/** The schema inside an optional wrapper, or the schema itself when it has none. */
const unwrapOptional = ({ schema }: { schema: z.ZodType }) => (schema instanceof z.ZodOptional ? schema.unwrap() : schema);

/**
 * The schema field a description key names, following one dot into a block —
 * which is what the two `timeouts.` leaves need.
 */
const findKeySchema = ({ key }: { key: string }) => {
	const [head, ...blockSegments] = key.split('.');
	let field: z.ZodType | undefined = configSchemaFields[head];

	for (const segment of blockSegments) {
		const block = field === undefined ? undefined : unwrapOptional({ schema: field });

		if (block instanceof z.ZodObject) {
			const blockFields: Record<string, z.ZodType> = block.shape;

			field = blockFields[segment];
		} else {
			field = undefined;
		}
	}

	return field;
};

/** A cell's text, with the one character a pipe table cannot carry escaped. */
const toCell = ({ text }: { text: string }) => text.replaceAll('|', '\\|');

/**
 * The config key reference as a markdown pipe table: one row per live top-level
 * key, in the order `configKeyDescriptions` declares them.
 *
 * The Required column is read from `LightsoutConfig` rather than written beside
 * each sentence, because a hand-written flag is a second fact to keep in step —
 * which is the drift this table exists to remove. A key is required when its
 * schema refuses `undefined`; a key whose schema cannot be resolved at all is a
 * bug in the constant, which the coverage test beside it catches.
 *
 * @returns the table's lines joined with newlines, with no leading or trailing newline — the script owns the blank lines around it
 */
export const renderConfigKeyReference = (): string => {
	const rows = Object.entries(configKeyDescriptions).map(([key, description]) => {
		const field = findKeySchema({ key });
		const required = field !== undefined && !field.safeParse(undefined).success;

		return `| \`${key}\` | ${required ? 'yes' : 'no'} | ${toCell({ text: description })} |`;
	});

	return ['| Field | Required | What it controls |', '| --- | ---: | --- |', ...rows].join('\n');
};
