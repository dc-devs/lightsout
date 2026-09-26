/** What every scene accepts: a listener called when the scene has played to its end. Left out, the scene loops. */
export interface SceneProps {
	onFinish?: () => void;
}
