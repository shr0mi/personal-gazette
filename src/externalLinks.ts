import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export async function openExternalLink(event: { preventDefault: () => void }, href: string): Promise<void> {
  // Browser previews retain normal link navigation; desktop links use the OS browser.
  if (!isTauri()) return;
  event.preventDefault();
  const url = new URL(href);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS links can be opened.");
  }
  await openUrl(url.href);
}
