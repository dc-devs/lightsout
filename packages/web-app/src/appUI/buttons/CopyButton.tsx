import { Check, Copy } from 'lucide-react';
import { type ComponentProps, useEffect, useState } from 'react';
import { Button } from '#src/appUI/buttons/Button.tsx';

interface Props {
	/** The text the clipboard receives. */
	value: string;
	/** What the control says before it is pressed — always names what will be copied, since three of these sit on one page. */
	label: string;
	/** The button's look; ghost unless a caller needs the copy to be the thing a reader presses. */
	variant?: ComponentProps<typeof Button>['variant'];
	/** Shows the icon alone. The label is still the accessible name, so a screen reader hears what a sighted reader infers from the icon. */
	isLabelHidden?: boolean;
	className?: string;
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
export const CopyButton = ({ value, label, variant = 'ghost', isLabelHidden = false, className }: Props) => {
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

	const text = copied ? 'Copied' : label;
	const Icon = copied ? Check : Copy;

	return (
		<Button
			type="button"
			variant={variant}
			size={isLabelHidden ? 'icon' : 'sm'}
			aria-label={isLabelHidden ? text : undefined}
			className={className}
			onClick={() => void copy()}
		>
			<Icon className="size-3.5" />
			{isLabelHidden ? null : text}
		</Button>
	);
};
