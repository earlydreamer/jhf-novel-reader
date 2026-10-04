import { expect, it } from 'vitest';
import { toSafeLog } from '../../src/contracts';
it('only emits whitelisted diagnostic values, never arbitrary fields or text', () => {
 const input = { event: 'request_failed', code: 'auth', status: 401, durationMs: 4, token: 'TOP-SECRET', headers: { Authorization: 'Bearer TOP-SECRET' }, text: 'FULL CHAPTER', message: 'FULL CHAPTER', url: 'https://user:TOP-SECRET@example.org', jobId: 'TOP-SECRET' };
 expect(toSafeLog(input)).toEqual({ event: 'request_failed', code: 'auth', status: 401, durationMs: 4 });
 expect(JSON.stringify(toSafeLog(input))).not.toMatch(/TOP-SECRET|FULL CHAPTER/);
});
it('drops untrusted values even in whitelisted fields', () => {
 expect(toSafeLog({ event: 'TOP-SECRET', code: 'FULL CHAPTER', status: 'secret', durationMs: NaN })).toEqual({ event: 'unknown' });
});
