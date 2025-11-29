export class RenderScheduler {
	private inFlight: Promise<void> | null = null;
	private queued = false;

	constructor(private readonly runner: () => Promise<void>) {}

	async run(): Promise<void> {
		if (this.inFlight) {
			this.queued = true;
			await this.inFlight;
			if (this.queued) {
				this.queued = false;
				return this.run();
			}
			return;
		}

		this.inFlight = this.runner();
		try {
			await this.inFlight;
		} finally {
			this.inFlight = null;
			if (this.queued) {
				this.queued = false;
				await this.run();
			}
		}
	}
}
