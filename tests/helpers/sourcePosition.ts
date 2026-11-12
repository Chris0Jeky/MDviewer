import type { Locator } from "@playwright/test";

/**
 * Put the source textarea at a selection and a scroll position, as a user who selects text
 * and then scrolls away from it would. Firefox scrolls a selection set by `setSelectionRange`
 * into view one frame later, even in an unfocused textarea (#227), so a scroll set in the same
 * task is overwritten after the test has recorded it. Let that scroll land, then scroll.
 */
export async function placeSource(
  input: Locator, start: number, end: number, direction: "forward" | "backward" | "none", scrollTop: number,
): Promise<void> {
  await input.evaluate(async (el: HTMLTextAreaElement, [start, end, direction, scrollTop]) => {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    el.setSelectionRange(start, end, direction);
    await frame();
    el.scrollTop = scrollTop;
    await frame();
  }, [start, end, direction, scrollTop] as const);
}
