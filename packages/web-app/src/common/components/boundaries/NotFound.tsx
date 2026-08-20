import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Button } from '#src/common/components/ui/Button.tsx';

interface Props {
	/** Replaces the default sentence when the caller knows what was missing. */
	children?: ReactNode;
}

/** The panel a route with nothing to show renders, with a way back to the runs list. */
export const NotFound = ({ children }: Props) => (
	<div className="flex flex-col items-start gap-3 p-8">
		<p className="text-muted-foreground text-sm">{children ?? 'That page does not exist.'}</p>
		<Button asChild size="sm">
			<Link to="/">Back to runs</Link>
		</Button>
	</div>
);
