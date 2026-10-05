import { ReaderError } from '../contracts';
/** Canonical API base used for both requests and cache identity. No credentials in URLs. */
export function normalizeOpenAICompatibleBaseUrl(value: string): string {
  try {
    // URL.search/hash are empty for bare delimiters, but href retains them.
    if (/[?#]/.test(value)) throw new Error();
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    const path = url.pathname.replace(/\/+$/, '');
    // Accept the server root or an explicit v1 API base (including a reverse-proxy prefix).
    if (path && !path.endsWith('/v1')) throw new Error();
    url.pathname = path || '/v1';
    return url.href.replace(/\/$/, '');
  } catch {
    throw new ReaderError('connection');
  }
}

/** Static text only: no endpoint, credentials, raw exception or novel content can be echoed. */
export function getLocalConnectionGuidance(): string {
  return 'localhost는 휴대폰 자신을 가리킵니다. PC의 LAN 주소와 기존 Ollama 또는 LM Studio 서버 실행 상태를 확인하세요. 서버를 공인 인터넷에 노출할 필요는 없습니다.';
}
