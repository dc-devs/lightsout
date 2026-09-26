import type { ReactNode } from 'react';
import { ShowcaseWindow } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/components/ShowcaseWindow.tsx';
import { useLoopingStep } from '#src/features/home/screens/Home/hooks/useLoopingStep.ts';

interface Props<TFrame> {
	/** What the window is showing, in its title bar. */
	title: string;
	/** The scene's frames, first to last; the last is what a reader who asked for less motion sees. */
	frames: TFrame[];
	/** How long each frame holds. */
	stepMs: number;
	/** Draws one frame. */
	renderFrame: (frame: TFrame) => ReactNode;
	/** Called when the last frame has held its full time. Given, the scene stays on its last frame for the caller to move on; left out, it loops. */
	onFinish?: () => void;
}

/** A scene played frame by frame in the showcase window, looping back to the start after its last frame unless someone is waiting for it to finish. */
export const LoopingScene = <TFrame,>({ title, frames, stepMs, renderFrame, onFinish }: Props<TFrame>) => {
	const step = useLoopingStep({ stepCount: frames.length, stepMs, onFinish });

	return <ShowcaseWindow title={title}>{renderFrame(frames[step])}</ShowcaseWindow>;
};
