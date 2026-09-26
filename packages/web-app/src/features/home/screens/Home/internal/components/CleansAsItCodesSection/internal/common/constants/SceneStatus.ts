/** Where an animation's story has got to: still growing, over the limit, being cleaned up, or clean. */
export const SceneStatus = { Working: 'working', Over: 'over', Fixing: 'fixing', Clean: 'clean' } as const;

export type SceneStatus = (typeof SceneStatus)[keyof typeof SceneStatus];
