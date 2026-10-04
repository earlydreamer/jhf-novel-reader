import { expect, it } from 'vitest';
import { auditAssets, auditProvenance } from './verify-apk.mjs';
const config = () => ({ appId: 'app.narou.reader', loggingBehavior: 'none', plugins: { CapacitorHttp: { enabled: false } }, server: { androidScheme: 'https' }, android: { allowMixedContent: false } });
const plugins = ['AppPlugin','FilesystemPlugin','PreferencesPlugin','SecureStorage'].map(classpath => ({ classpath }));
const html = `<html><head><meta http-equiv="Content-Security-Policy" content="script-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><script src="/assets/app.js"></script></head></html>`;
it('requires web and native builds from the same clean current commit', () => {
 const current = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false };
 expect(() => auditProvenance(current, current, current)).not.toThrow();
 expect(() => auditProvenance({ ...current, commit: 'c'.repeat(40) }, current, current)).toThrow();
 expect(() => auditProvenance(current, { ...current, tree: 'c'.repeat(40) }, current)).toThrow();
 expect(() => auditProvenance({ ...current, dirty: true }, current, current)).toThrow();
 expect(() => auditProvenance(current, { ...current, dirty: true }, current)).toThrow();
});
it('accepts complete bundled native assets', () => expect(() => auditAssets(config(), plugins, html)).not.toThrow());
it('accepts the HTML entity encoding emitted by Vite for a meta policy', () => expect(() => auditAssets(config(), plugins, html.replaceAll("'", '&#39;'))).not.toThrow());
it.each(['logging','patch','mixed','remote','navigation'])('rejects unsafe packaged %s config', key => {
 const value = config();
 if(key === 'logging') value.loggingBehavior = 'debug';
 if(key === 'patch') value.plugins.CapacitorHttp.enabled = true;
 if(key === 'mixed') value.android.allowMixedContent = true;
 if(key === 'remote') value.server.url = 'https://example.invalid';
 if(key === 'navigation') value.server.allowNavigation = ['*'];
 expect(() => auditAssets(value, plugins, html)).toThrow();
});
it('rejects missing native secure storage', () => expect(() => auditAssets(config(), plugins.slice(0,3), html)).toThrow());
it('rejects missing policy or an inline script', () => {
 expect(() => auditAssets(config(), plugins, '<head></head>')).toThrow();
 expect(() => auditAssets(config(), plugins, html.replace('</head>', '<script>unsafe()</script></head>'))).toThrow();
});
