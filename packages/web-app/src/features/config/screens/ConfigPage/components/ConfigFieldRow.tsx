import type { ConfigFieldView } from '@lightsout/engine';
import { Badge, MetadataTag } from '#src/appUI/index.ts';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';

/**
 * The value as JSON, or the words that say there is no value to show.
 *
 * A null here is never "the config said null" — the contract uses it for a key
 * lightsout applies no named default to, so the honest rendering is a sentence
 * rather than the literal `null`, which would read as a setting somebody chose.
 */
const FieldValue = ({ value }: { value: ConfigFieldView['value'] }) => {
	if (value === null) {
		return <span className="text-muted-foreground text-xs">default: none</span>;
	}

	return typeof value === 'object' ? (
		<pre className="min-w-0 overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-muted-foreground-strong text-xs">
			{JSON.stringify(value, null, '\t')}
		</pre>
	) : (
		<code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{JSON.stringify(value)}</code>
	);
};

interface Props {
	field: ConfigFieldView;
}

/**
 * One config key: what it holds here, who decided that, and what the key is for.
 *
 * The provenance badge is the whole point of the row. A reader can already open
 * their own config file; what they cannot look up is which of these values they
 * never wrote.
 */
export const ConfigFieldRow = ({ field }: Props) => (
	<div className="flex flex-col gap-1.5 border-border border-b py-3 last:border-0 last:pb-0 first:pt-0">
		<div className="flex flex-wrap items-center gap-2">
			<MetadataTag>{field.key}</MetadataTag>
			<Badge variant={field.fromConfig ? BadgeVariant.Running : BadgeVariant.Neutral}>{field.fromConfig ? 'from config' : 'default'}</Badge>
		</div>
		<FieldValue value={field.value} />
		<p className="text-muted-foreground text-xs leading-5">{field.description}</p>
	</div>
);
