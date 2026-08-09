interface GreetParams {
	greeting: string;
}

// Positional constructor arguments, and a separate interface for a method that
// takes one property — both of the shapes the section rules out.
export class Person {
	private readonly name: string;

	constructor(name: string, isActive = true) {
		this.name = isActive ? name : `${name} (inactive)`;
	}

	greet(params: GreetParams) {
		return `${params.greeting}, my name is ${this.name}.`;
	}
}
