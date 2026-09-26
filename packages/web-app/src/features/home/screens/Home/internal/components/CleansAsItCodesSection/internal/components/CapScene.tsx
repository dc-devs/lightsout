import { SceneStatus } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/constants/SceneStatus.ts';
import type { CapSceneDefinition } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/types/CapSceneDefinition.ts';
import type { SceneProps } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/types/SceneProps.ts';
import { LoopingScene } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/LoopingScene.tsx';

interface Props<TFrame extends { status: SceneStatus }> extends SceneProps {
	scene: CapSceneDefinition<TFrame>;
}

/** Plays a grow-past-the-limit scene: the growing frames first, then the cleaned-up result, then round again. */
export const CapScene = <TFrame extends { status: SceneStatus }>({ scene, onFinish }: Props<TFrame>) => (
	<LoopingScene
		title={scene.title}
		frames={scene.frames}
		stepMs={900}
		renderFrame={(frame) => (frame.status === SceneStatus.Clean ? scene.renderClean() : scene.renderGrowing(frame))}
		onFinish={onFinish}
	/>
);
