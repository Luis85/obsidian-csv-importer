import { browser } from "@wdio/globals";
import { contrast, flatten, floor2, type Rgba } from "./contrast";
import { setColorScheme } from "./support";

/**
 * Helpers for the appearance spec: colours and boxes read from the rendered page in Obsidian. Adapted from
 * tests/e2e/appearance.ts of the author's weg-manager plugin. Code passed to `execute` is serialised, so the
 * collector carries its own colour parser: it reads a computed colour through `color-mix(in srgb, ...)`, which
 * Chromium serialises with exact channels and alpha whatever space the colour was written in.
 */

type TextSample = { readonly text: string; readonly testid: string; readonly fg: Rgba; readonly layers: readonly Rgba[] };

export type Measured = { readonly text: string; readonly testid: string; readonly ratio: number };

/** Every visible, enabled text inside `scope`, with its colours. */
const textSamples = (scope: string): Promise<TextSample[]> =>
	browser.execute((selector) => {
		const probe = document.createElement("i");
		document.body.append(probe);
		const parse = (css: string): [number, number, number, number] => {
			probe.style.color = `color-mix(in srgb, ${css} 100%, transparent)`;
			const text = getComputedStyle(probe).color;
			const numbers = (text.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
			const scale = text.startsWith("color(") ? 255 : 1;
			const [r = 0, g = 0, b = 0, a = 1] = numbers;
			const clamp = (value: number) => Math.min(255, Math.max(0, value * scale));
			return [clamp(r), clamp(g), clamp(b), a];
		};
		const layersOf = (element: Element) => {
			const layers: [number, number, number, number][] = [];
			for (let node: Element | null = element; node !== null; node = node.parentElement) {
				const layer = parse(getComputedStyle(node).backgroundColor);
				if (layer[3] > 0) layers.push(layer);
				if (layer[3] >= 1) return layers;
			}
			layers.push([255, 255, 255, 1]);
			return layers;
		};
		const root = document.querySelector(selector);
		const samples = [...(root?.querySelectorAll("*") ?? [])]
			.filter((element) =>
				[...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== ""),
			)
			.filter((element) => {
				const box = element.getBoundingClientRect();
				return (
					box.width > 1 &&
					box.height > 1 &&
					element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
					element.closest(":disabled, [aria-disabled=true]") === null
				);
			})
			.map((element) => ({
				text: (element.textContent ?? "").trim().slice(0, 50),
				testid: element.closest("[data-testid]")?.getAttribute("data-testid") ?? "",
				fg: parse(getComputedStyle(element).color),
				layers: layersOf(element),
			}));
		probe.remove();
		return samples;
	}, scope);

/** Contrast of every visible text inside `scope` against the background it sits on. */
export const measureTexts = async (scope: string): Promise<Measured[]> => {
	await settleColours();
	return (await textSamples(scope)).map(({ text, testid, fg, layers }) => ({
		text,
		testid,
		ratio: floor2(contrast(fg, flatten(layers))),
	}));
};

/** Switches Obsidian's base theme and waits until the page follows and colours settle. */
export const useScheme = async (scheme: "light" | "dark") => {
	await setColorScheme(scheme);
	await browser.waitUntil(
		() => browser.execute((wanted) => document.body.classList.contains(`theme-${wanted}`), scheme),
		{ timeoutMsg: `the page never turned ${scheme}` },
	);
	await settleColours();
};

/**
 * Brings every colour of the page to its resting value, so a read is neither the old nor the new colour of a
 * fade. Transitions and finite animations are jumped to their end (`finish()`) until none is left; this does
 * not wait for frames (a window without a window manager gets none). Fails after 20 passes, naming what ran on.
 */
export const settleColours = async () => {
	const left = await browser.execute(() => {
		const stuck = new Set<Animation>();
		const running = () => {
			getComputedStyle(document.documentElement).getPropertyValue("color");
			return document
				.getAnimations()
				.filter(
					(animation) =>
						!stuck.has(animation) &&
						animation.playState !== "finished" &&
						animation.playState !== "idle" &&
						animation.effect?.getComputedTiming().iterations !== Infinity,
				);
		};
		const describe = (animation: Animation): string => {
			const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
			const name =
				animation instanceof CSSAnimation
					? `animation ${animation.animationName}`
					: animation instanceof CSSTransition
						? `transition of ${animation.transitionProperty}`
						: "script animation";
			return `${name} on ${target === null ? "no target" : `${target.tagName.toLowerCase()}.${target.getAttribute("class") ?? ""}`}`;
		};
		for (let pass = 0; pass < 20; pass += 1) {
			const current = running();
			if (current.length === 0) return [];
			for (const animation of current) {
				try {
					animation.finish();
				} catch {
					stuck.add(animation);
				}
			}
		}
		return running().map(describe);
	});
	if (left.length > 0) throw new Error(`${left.length} animations kept running after 20 passes: ${left.join("; ")}`);
};

/** Moves the pointer off the UI, so no hover colour is measured. */
export const parkPointer = async () => {
	await browser.action("pointer").move({ x: 1, y: 1, origin: "viewport" }).perform();
	await settleColours();
};

/** Computed styles of every element matching `css` inside `scope`. */
export const stylesOf = async (scope: string, css: string, properties: readonly string[]) => {
	await settleColours();
	return browser.execute(
		(selector, inner, names) =>
			[...(document.querySelector(selector)?.querySelectorAll(inner) ?? [])].map((element) => {
				const style = getComputedStyle(element);
				return Object.fromEntries([
					["element", element.tagName.toLowerCase()],
					["text", (element.textContent ?? "").trim().slice(0, 40)],
					...names.map((name) => [name, style.getPropertyValue(name)]),
				]) as Record<string, string>;
			}),
		scope,
		css,
		[...properties],
	);
};

/** Elements inside `scope` whose box reaches past the scope's right edge, and its horizontal scroll. */
export const overflow = (scope: string) =>
	browser.execute((selector) => {
		const root = document.querySelector<HTMLElement>(selector);
		if (root === null) return { scroll: -1, past: ["no root"] };
		const edge = root.getBoundingClientRect().right;
		const past = [...root.querySelectorAll("*")]
			.filter((element) => element.getBoundingClientRect().right > edge + 0.5 && element.checkVisibility())
			.map((element) => element.closest("[data-testid]")?.getAttribute("data-testid") ?? (element.className.toString() || "?"));
		return { scroll: root.scrollWidth - root.clientWidth, past: [...new Set(past)] };
	}, scope);
