import type { ReactNode } from 'react';
import type { SceneStatus } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/common/constants/SceneStatus.ts';

/** A scene where something grows past a Standards Pack limit and is cleaned back under it: its title, its frames, and how to draw either half. */
export interface CapSceneDefinition<TFrame extends { status: SceneStatus }> {
	title: string;
	frames: TFrame[];
	/** Draws a frame before the clean-up: growing, over the limit, or being fixed. */
	renderGrowing: (frame: TFrame) => ReactNode;
	/** Draws the cleaned-up result. */
	renderClean: () => ReactNode;
}
