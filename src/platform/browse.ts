import { Capacitor, registerPlugin } from '@capacitor/core';
import { ReaderError } from '../contracts';
import { normalizeSourceInput } from '../source/work';
import { BROWSE_SITES } from './browseSites';

interface SourceBrowserPlugin {
  open(options: { startUrl: string }): Promise<unknown>;
}
const browser = registerPlugin<SourceBrowserPlugin>('SourceBrowser');
const hosts = new Set(BROWSE_SITES.flatMap((site) => site.hosts));

export function normalizeBrowseStartUrl(input: string): string {
  try {
    if (
      /[\\\u0000-\u0020]/.test(input) ||
      input.split(/[?#]/, 1)[0]!.includes('%') ||
      /\/\.{1,2}(?:\/|$)/.test(input)
    )
      throw new Error();
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      /^https:\/\/[^/?#]*:[0-9]+(?:[/?#]|$)/i.test(input) ||
      !hosts.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      throw new Error();
    url.hash = '';
    return url.href;
  } catch {
    throw new ReaderError('source_access');
  }
}

/** Trusted UI entry only. The native activity exposes no page-to-app bridge. */
export async function openSourceBrowser(
  startUrl = BROWSE_SITES[0]!.startUrl,
): Promise<{ selectedUrl: string } | null> {
  const url = normalizeBrowseStartUrl(startUrl);
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android')
    throw new ReaderError('source_access');
  const result = await browser.open({ startUrl: url });
  if (typeof result !== 'object' || result === null || !('selectedUrl' in result))
    throw new ReaderError('source_access');
  if (result.selectedUrl === null) return null;
  if (typeof result.selectedUrl !== 'string') throw new ReaderError('source_access');
  const input = normalizeSourceInput(result.selectedUrl);
  return { selectedUrl: input.chapterUrl || input.workUrl };
}
