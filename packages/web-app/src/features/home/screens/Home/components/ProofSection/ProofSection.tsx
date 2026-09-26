import { ShieldCheck } from 'lucide-react';
import { FadeIn } from '#src/appUI/index.ts';
import { SectionPill } from '#src/features/home/components/SectionPill.tsx';
import { GateLog } from '#src/features/home/screens/Home/components/ProofSection/components/GateLog.tsx';

/**
 * The deterministic gates, and a run's log showing one of them overrule the
 * agent.
 *
 * The claim is the engine's: the repo's own commands run between every step,
 * run by the engine rather than the agent, and their exit codes decide.
 */
export const ProofSection = () => (
	<section className="relative w-full px-4 py-24">
		<div className="mx-auto flex max-w-6xl flex-col gap-14">
			<div className="flex flex-col items-center text-center">
				<FadeIn>
					<SectionPill icon={ShieldCheck} label="Proof" className="mb-8" />
				</FadeIn>
				<FadeIn delayMs={100}>
					<h2 className="font-extrabold text-4xl text-drop-navy tracking-tight md:text-5xl">
						Deterministic gates decide what passes. <br />
						<span className="text-primary">Not the agent.</span>
					</h2>
				</FadeIn>
				<FadeIn delayMs={200}>
					<p className="mt-6 max-w-2xl text-muted-foreground text-lg leading-relaxed">
						Between every step, lightsout runs your own lint, type checks, tests and build.
					</p>
				</FadeIn>
			</div>
			<FadeIn delayMs={300} className="mx-auto w-full max-w-3xl">
				<GateLog />
			</FadeIn>
		</div>
	</section>
);
