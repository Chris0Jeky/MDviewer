/** Read and drive the reader's document tabs (S3) in jsdom tests. A dirty tab reads "• name". */
const tabs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('#shell-tabs [role="tab"]')];
const text = (tab: HTMLElement): string =>
  `${tab.closest(".shell-tab")?.classList.contains("is-dirty") ? "• " : ""}${tab.querySelector(".shell-tab-label")!.textContent}`;

export const tabTexts = (): string[] => tabs().map(text);
export const tabCount = (): number => tabs().length;
export function activeTab(): string {
  const tab = tabs().find(candidate => candidate.getAttribute("aria-selected") === "true");
  return tab ? text(tab) : "";
}
export const activeTabId = (): string | undefined => tabs().find(tab => tab.getAttribute("aria-selected") === "true")?.dataset.docId;
export function selectTab(id: string): void {
  tabs().find(tab => tab.dataset.docId === id)!.click();
}
