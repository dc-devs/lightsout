import { Injectable } from '@nestjs/common';

@Injectable()
export class EventsService {
	private readonly events: string[] = [];

	record({ name }: { name: string }): void {
		this.events.push(name);
	}

	list(): string[] {
		return [...this.events];
	}
}
