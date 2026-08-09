interface ConstructorParams {
	name: string;
	isActive?: boolean;
}

export class Person {
	private readonly name: string;

	private isActive: boolean;

	constructor({ name, isActive = true }: ConstructorParams) {
		this.name = name;
		this.isActive = isActive;
	}

	greet({ greeting }: { greeting: string }): string {
		return `${greeting}, my name is ${this.name}.`;
	}

	setActiveStatus({ status }: { status: boolean }): void {
		this.isActive = status;
	}

	isCurrentlyActive(): boolean {
		return this.isActive;
	}
}
