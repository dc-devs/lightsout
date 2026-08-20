import type { ErrorComponentProps } from '@tanstack/react-router';
import { Link, useRouter } from '@tanstack/react-router';
import { Button } from '#src/common/components/ui/Button.tsx';

/** What the router renders when a route throws: the message, a retry, and a way back to the runs list. */
export const DefaultCatchBoundary = ({ error }: ErrorComponentProps) => {
	const router = useRouter();

	return (
		<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-8">
			<div className="flex flex-col items-center gap-2">
				<h1 className="font-bold text-xl">Something went wrong</h1>
				<p className="max-w-lg text-center text-destructive text-sm">{error.message}</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => {
						router.invalidate();
					}}
				>
					Try again
				</Button>
				<Button asChild size="sm">
					<Link to="/">Back to runs</Link>
				</Button>
			</div>
		</div>
	);
};
