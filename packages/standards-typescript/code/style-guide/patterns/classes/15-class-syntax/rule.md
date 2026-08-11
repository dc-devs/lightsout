---
summary: "a class whose constructor takes positional arguments, or whose methods declare separate param interfaces"
checked: false
severity: advisory
---

## Syntax & Style

- Constructor takes an object argument, destructured; declare a `ConstructorParams` interface for it.
- **Instance methods** use inline object types for their params — not separate interfaces (keeps the signature self-contained, avoids interface-file sprawl).
- Public methods of an exported class declare return types; `private` methods infer (see [return-types.md](../typescript/return-types.md)). Interface-pinned methods need not restate the type.
- Export the class as a named export on the line it is defined.

```typescript
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

	greet(): string {
		return `Hello, my name is ${this.name}.`;
	}

	setActiveStatus({ status }: { status: boolean }): void {
		this.isActive = status;
	}
}
```
