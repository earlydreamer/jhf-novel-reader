import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
 appId: 'app.narou.reader', appName: 'narou-reader', webDir: 'dist',
 // Default debug bridge logging exposes plugin arguments (auth/body/secrets).
 loggingBehavior: 'none',
 // Use direct native HTTP only. Never globally patch browser fetch/XMLHttpRequest.
 plugins: { CapacitorHttp: { enabled: false } }
};
export default config;
