import { Capacitor } from '@capacitor/core';
import { Journal, type PrivateFiles } from './journal';
import { createReadingSettingsRepository, type PreferenceBackend } from './settings';
import { createNativePrivateFiles, createNativePreferences } from './native';
import { createNativeSecretStore, type EnumerableSecretStore } from './secrets';
import { validateBatch } from '../translation/batch';

// Only this application's generated v4 UUID references are eligible. Legacy names stay intact.
const generatedRef =
  /^provider\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Startup only, after restore recovery and before creating controllers or requests.
 * Keep both recovery slots, even completed batches. Unknown roots mean no deletion.
 * A failed cleanup is optional maintenance: never prevent reading or expose plugin errors.
 */
export async function cleanupUnreferencedCredentials(
  files: PrivateFiles,
  preferences: PreferenceBackend,
  secrets: Pick<EnumerableSecretStore, 'keys' | 'remove'>,
): Promise<void> {
  try {
    const saved = await createReadingSettingsRepository(preferences).readReadingSettings();
    const batches = await new Journal(files).readSlots('batches/current', validateBatch);
    if (batches.invalidSlots.length) return;
    const retained = new Set<string>();
    const selectedRef = saved.selection?.connection.authRef;
    if (selectedRef) retained.add(selectedRef);
    for (const entry of batches.entries) {
      const ref = entry.value?.selection.connection.authRef;
      if (ref) retained.add(ref);
    }
    const refs = await secrets.keys();
    for (const ref of refs) {
      if (generatedRef.test(ref) && !retained.has(ref)) await secrets.remove(ref);
    }
  } catch {
    // Keep remaining keys and retry on a later cold start. Never guess missing roots.
  }
}

let startup: Promise<void> | undefined;
/** Called once by bootstrap after native restore recovery, never by controller initialize/dispose. */
export function cleanupNativeCredentialsBeforeStartup(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android')
    return Promise.resolve();
  return (startup ??= cleanupUnreferencedCredentials(
    createNativePrivateFiles(),
    createNativePreferences(),
    createNativeSecretStore(),
  ));
}
