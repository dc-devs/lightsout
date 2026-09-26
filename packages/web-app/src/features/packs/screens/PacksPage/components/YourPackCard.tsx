import { Link } from '@tanstack/react-router';
import { ArrowRight, Plus } from 'lucide-react';

/** The card after the built-in rule sets: a team's own pack, and where the docs say how to write one. */
export const YourPackCard = () => (
	<div className="flex flex-col gap-6 rounded-2xl border-2 border-primary-tint-border border-dashed p-6">
		<span className="flex size-11 items-center justify-center rounded-xl bg-primary-tint text-primary">
			<Plus aria-hidden="true" className="size-5" />
		</span>
		<div className="flex flex-col gap-1">
			<h3 className="font-bold text-drop-navy text-xl">Your team’s pack</h3>
			<p className="text-muted-foreground text-sm leading-relaxed">Write your own rules, and use them alone or stack them on these.</p>
		</div>
		<Link
			to="/docs/$doc"
			params={{ doc: 'configuration' }}
			hash="adding-your-standards"
			className="mt-auto inline-flex items-center gap-1 font-semibold text-primary text-sm transition-colors hover:text-primary-hover"
		>
			How to add your own
			<ArrowRight aria-hidden="true" className="size-4" />
		</Link>
	</div>
);
