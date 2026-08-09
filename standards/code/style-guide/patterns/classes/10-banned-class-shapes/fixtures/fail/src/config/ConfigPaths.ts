// A module wearing a costume: the class binds no state and exists only to put
// a `ConfigPaths.` prefix in front of three values.
export class ConfigPaths {
	static readonly root = '.lightsout';

	static readonly config = '.lightsout/config.json';

	static forRun({ id }: { id: string }): string {
		return `.lightsout/runs/${id}`;
	}
}
