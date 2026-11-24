// When a running import persists its state (snapshot + undo): after the first written note, then every
// 200 written notes or 2 s, never closer than 0.5 s apart.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkpointer } from "../../src/import/checkpointer";

/** A checkpointer on a manual clock that starts at 10 s (so "now + last" and "now - last" differ). */
function make(save: () => void | Promise<void> = () => undefined) {
	let t = 10_000;
	const saves = vi.fn(save);
	const cp = new Checkpointer(saves, () => t);
	return {
		cp,
		saves,
		advance: (ms: number) => {
			t += ms;
		},
	};
}

/** Resolves after pending microtasks (and the save chain) have run. */
const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
}

describe("Checkpointer: first checkpoint", () => {
	it("saves right after the first row that wrote a note", async () => {
		const { cp, saves } = make();
		await cp.afterRow(0);
		await cp.afterRow(0);
		expect(saves).not.toHaveBeenCalled();
		await cp.afterRow(1);
		await cp.settled();
		expect(saves).toHaveBeenCalledTimes(1);
	});

	it("does not save again on the next written row", async () => {
		const { cp, saves } = make();
		await cp.afterRow(1);
		await cp.afterRow(1);
		await cp.afterRow(1);
		await cp.settled();
		expect(saves).toHaveBeenCalledTimes(1);
	});
});

describe("Checkpointer: later checkpoints", () => {
	async function started() {
		const m = make();
		await m.cp.afterRow(1);
		await m.cp.settled();
		m.saves.mockClear();
		return m;
	}

	it("saves after 200 written rows once 0.5 s have passed", async () => {
		const { cp, saves, advance } = await started();
		advance(500);
		await cp.afterRow(199);
		await cp.settled();
		expect(saves).not.toHaveBeenCalled();
		await cp.afterRow(1);
		await cp.settled();
		expect(saves).toHaveBeenCalledTimes(1);
	});

	it("counts written rows across calls and restarts the count after a save", async () => {
		const { cp, saves, advance } = await started();
		advance(600);
		for (let i = 0; i < 200; i++) await cp.afterRow(1);
		await cp.settled();
		expect(saves).toHaveBeenCalledTimes(1);
		advance(600);
		await cp.afterRow(199);
		await cp.settled();
		expect(saves).toHaveBeenCalledTimes(1);
	});

	it("never saves closer than 0.5 s, even after 200 rows", async () => {
		const { cp, saves, advance } = await started();
		advance(499);
		await cp.afterRow(500);
		await cp.settled();
		expect(saves).not.toHaveBeenCalled();
		advance(1);
		await cp.afterRow(0);
		await cp.settled();
		expect(saves).toHaveBeenCalledTimes(1);
	});

	it("saves after 2 s when at least one row was written", async () => {
		const { cp, saves, advance } = await started();
		advance(1999);
		await cp.afterRow(1);
		await cp.settled();
		expect(saves).not.toHaveBeenCalled();
		advance(1);
		await cp.afterRow(0);
		await cp.settled();
		expect(saves).toHaveBeenCalledTimes(1);
	});

	it("does not save when nothing was written since the last save", async () => {
		const { cp, saves, advance } = await started();
		advance(5000);
		await cp.afterRow(0);
		await cp.settled();
		expect(saves).not.toHaveBeenCalled();
	});

	it("measures time from the last save", async () => {
		const { cp, saves, advance } = await started();
		advance(100);
		await cp.afterRow(1);
		await cp.settled();
		expect(saves).not.toHaveBeenCalled();
	});
});

describe("Checkpointer: waiting", () => {
	it("afterRow does not wait for the save to finish", async () => {
		const d = deferred();
		const { cp } = make(() => d.promise);
		let returned = false;
		void cp.afterRow(1).then(() => (returned = true));
		await flushMicrotasks();
		expect(returned).toBe(true);
		d.resolve();
	});

	it("flush saves and waits for the save to finish", async () => {
		const d = deferred();
		const { cp, saves } = make(() => d.promise);
		let flushed = false;
		void cp.flush().then(() => (flushed = true));
		await flushMicrotasks();
		expect(saves).toHaveBeenCalledTimes(1);
		expect(flushed).toBe(false);
		d.resolve();
		await flushMicrotasks();
		expect(flushed).toBe(true);
	});

	it("settled waits for a save still running", async () => {
		const d = deferred();
		const { cp } = make(() => d.promise);
		await cp.afterRow(1);
		let settled = false;
		void cp.settled().then(() => (settled = true));
		await flushMicrotasks();
		expect(settled).toBe(false);
		d.resolve();
		await flushMicrotasks();
		expect(settled).toBe(true);
	});

	it("chains saves so they never overlap, and swallows failures", async () => {
		const order: string[] = [];
		const first = deferred();
		let n = 0;
		const { cp } = make(async () => {
			const i = ++n;
			order.push(`start ${i}`);
			if (i === 1) {
				await first.promise;
				order.push("end 1");
				throw new Error("disk full");
			}
			order.push(`end ${i}`);
		});
		await cp.afterRow(1);
		const flushed = cp.flush();
		await flushMicrotasks();
		expect(order).toEqual(["start 1"]);
		first.resolve();
		await expect(flushed).resolves.toBeUndefined();
		expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
	});

	it("without a save callback it does nothing", async () => {
		const cp = new Checkpointer(undefined, () => 0);
		await expect(cp.afterRow(1)).resolves.toBeUndefined();
		await expect(cp.flush()).resolves.toBeUndefined();
		await expect(cp.settled()).resolves.toBeUndefined();
	});
});

describe("Checkpointer: default clock", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("uses the real clock when none is given", async () => {
		vi.useFakeTimers({ toFake: ["performance", "Date"] });
		const saves = vi.fn();
		const cp = new Checkpointer(saves);
		await cp.afterRow(1);
		await cp.settled();
		expect(saves).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(2500);
		await cp.afterRow(1);
		await cp.settled();
		expect(saves).toHaveBeenCalledTimes(2);
	});
});
