import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
 appId: 'app.narou.reader', appName: 'narou-reader', webDir: 'dist',
 // Default debug bridge logging exposes plugin arguments (auth/body/secrets).
 loggingBehavior: 'none',
 // Bundled UI stays HTTPS; direct native HTTP can reach the chosen model server.
 server: { androidScheme: 'https' },
 android: { allowMixedContent: false },
 // Use direct native HTTP only. Never globally patch browser fetch/XMLHttpRequest.
 plugins: { CapacitorHttp: { enabled: false } }
};
export default config;
