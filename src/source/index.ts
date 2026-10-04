import { ReaderError, type SourceAdapter, type SourceTransport, type Chapter } from '../contracts';
import {
  normalizeSourceUrl,
  sourceIdentity,
  documentFragment,
  BODY,
  parseWork,
  parseChapter,
} from './parse';
export { normalizeSourceUrl, parseWork, parseChapter, type WorkIndex } from './parse';
export { createRenewalSource, normalizeSourceInput, normalizeWorkPageUrl } from './work';

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new ReaderError('cancelled');
}
export class NarouSourceAdapter implements SourceAdapter {
  constructor(private readonly transport: SourceTransport) {}
  private async getHtml(url: string, signal: AbortSignal): Promise<string> {
    checkCancelled(signal);
    const response = await this.transport.get(url, signal);
    checkCancelled(signal);
    if (response.status !== 200)
      throw new ReaderError('source_access', 'received', response.status);
    const contentType =
      Object.entries(response.headers).find(
        ([name]) => name.toLowerCase() === 'content-type',
      )?.[1] || '';
    if (
      response.url !== url ||
      !/^text\/html(?:\s*;|\s*$)/i.test(contentType) ||
      typeof response.data !== 'string'
    )
      throw new ReaderError('source_access');
    return response.data;
  }
  async getChapter(inputUrl: string, signal: AbortSignal): Promise<Chapter> {
    let url = normalizeSourceUrl(inputUrl);
    let html = await this.getHtml(url, signal);
    if (!sourceIdentity(url).episode && !documentFragment(html).querySelector(BODY)) {
      // Never paginate or collect a work. Resolve its first listed episode once.
      url = parseWork(html, url).chapters[0]!.url;
      html = await this.getHtml(url, signal);
    }
    const result = await parseChapter(html, url);
    checkCancelled(signal);
    return result;
  }
}
