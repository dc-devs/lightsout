import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '#src/common/components/ui/Button.tsx';

interface Props {
	/** The text the clipboard receives. */
	value: string;
	/** What the control says before it is pressed — always names what will be copied, since three of these sit on one page. */
	label: string;
}

/**
 * The one copy control in the app: it writes a string to the clipboard and says
 * so for a moment.
 *
 * A browser that refuses the clipboard — an insecure origin, a denied
 * permission — leaves the label where it was rather than throwing into the
 * render tree. Nothing here acts on a run; every use copies text a reader then
 * runs themselves.
 */
export const CopyButton = ({ value, label }: Props) => {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) {
			return;
		}

		const timer = setTimeout(() => setCopied(false), 1_500);

		return () => clearTimeout(timer);
	}, [copied]);

	const copy = async () => {
		const written = await navigator.clipboard.writeText(value).then(
			() => true,
			() => false,
		);

		setCopied(written);
	};

	return (
		<Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
			{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
			{copied ? 'Copied' : label}
		</Button>
	);
};
