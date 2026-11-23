/** Checkpoint (persist snapshot + undo) after this many written rows, at most every CHECKPOINT_MIN_MS. */
const CHECKPOINT_ROWS = 200;
const CHECKPOINT_MIN_MS = 2000;
/** Never checkpoint more often than this, not even the early one after the first written note. */
const CHECKPOINT_FLOOR_MS = 500;

const defaultNow = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Decides when a running import persists its state: once after the first written note, then every
 * CHECKPOINT_ROWS written notes or CHECKPOINT_MIN_MS (but never closer than CHECKPOINT_FLOOR_MS).
 * Saves are chained so they never overlap and failures are swallowed: the final save reports problems.
 */
export class Checkpointer {
	private last: number;
	private since = 0;
	private started = false;
	private pending: Promise<unknown> = Promise.resolve();

	/** `save` undefined disables checkpointing (dry runs, callers without a callback). */
	constructor(
		private readonly save: (() => void | Promise<void>) | undefined,
		private readonly now: () => number = defaultNow,
	) {
		this.last = this.now();
	}

	/** Call after each row with the number of notes it wrote. */
	async afterRow(wrote: number): Promise<void> {
		this.since += wrote;
		const elapsed = this.now() - this.last;
		const first = !this.started && wrote > 0;
		if (first || (elapsed >= CHECKPOINT_FLOOR_MS && this.since > 0 && (this.since >= CHECKPOINT_ROWS || elapsed >= CHECKPOINT_MIN_MS))) {
			await this.checkpoint(false);
		}
	}

	/** Saves now and waits for it (used when the run is stopped). */
	flush(): Promise<void> {
		return this.checkpoint(true);
	}

	/** Waits for any save still running, so a late one cannot overwrite the caller's final save. */
	async settled(): Promise<void> {
		await this.pending;
	}

	private async checkpoint(wait: boolean): Promise<void> {
		const save = this.save;
		if (!save) return;
		this.started = true;
		this.since = 0;
		this.last = this.now();
		const p = this.pending.then(() => save()).catch(() => undefined); // best effort
		this.pending = p;
		if (wait) await p;
	}
}
