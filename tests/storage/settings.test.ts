import { describe, expect, it } from "vitest";
import {
  createSettingsRepository,
  type PreferenceBackend,
} from "../../src/storage/settings";
import type { ProviderConfig } from "../../src/contracts";
const config: ProviderConfig = {
  provider: "openai-compatible",
  baseUrl: "http://192.0.2.1:1234/v1",
  model: "local",
  authRef: "provider.local",
  contextBudget: 8192,
  outputBudget: 2048,
  settingsRevision: 1,
};
function backend() {
  const data = new Map<string, string>();
  const api: PreferenceBackend = {
    async get({ key }) {
      return { value: data.get(key) ?? null };
    },
    async set({ key, value }) {
      data.set(key, value);
    },
  };
  return { api, data };
}
describe("non-secret preferences", () => {
  it("defaults prefetch OFF and round-trips only small settings", async () => {
    const b = backend(),
      store = createSettingsRepository(b.api);
    expect(await store.read()).toEqual({
      config: null,
      preferences: { fontSize: 18, prefetchEnabled: false },
    });
    await store.save({
      config,
      preferences: { fontSize: 20, prefetchEnabled: true },
    });
    expect(await createSettingsRepository(b.api).read()).toEqual({
      config,
      preferences: { fontSize: 20, prefetchEnabled: true },
    });
  });
  it.each([
    { secret: "fake-secret" },
    { authorization: "Bearer fake-secret" },
    { apiKey: "fake-secret" },
  ])("rejects credential-shaped extra fields", async (extra) => {
    const b = backend(),
      store = createSettingsRepository(b.api);
    await expect(
      store.save({
        config: { ...config, ...extra },
        preferences: { fontSize: 18, prefetchEnabled: false },
      }),
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(b.data.size).toBe(0);
  });
  it.each([
    "https://user:password@example.com/v1",
    "https://example.com/v1?key=fake-secret",
    "javascript:alert(1)",
  ])("rejects credential-bearing/unsafe endpoint %s", async (baseUrl) => {
    const b = backend();
    await expect(
      createSettingsRepository(b.api).save({
        config: { ...config, baseUrl },
        preferences: { fontSize: 18, prefetchEnabled: false },
      }),
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(b.data.size).toBe(0);
  });
  it("rejects future schema on read and write without discarding it", async () => {
    const b = backend(),
      store = createSettingsRepository(b.api);
    await store.save({
      config,
      preferences: { fontSize: 18, prefetchEnabled: false },
    });
    const key = [...b.data.keys()][0]!,
      future = JSON.stringify({ schemaVersion: 99 });
    b.data.set(key, future);
    await expect(store.read()).rejects.toMatchObject({
      reason: "unsupported_schema",
    });
    await expect(
      store.save({
        config: null,
        preferences: { fontSize: 18, prefetchEnabled: false },
      }),
    ).rejects.toMatchObject({ reason: "unsupported_schema" });
    expect(b.data.get(key)).toBe(future);
  });
  it("reports corruption and I/O failures without emitting backend messages", async () => {
    const b = backend(),
      store = createSettingsRepository(b.api);
    await store.save({
      config,
      preferences: { fontSize: 18, prefetchEnabled: false },
    });
    b.data.set([...b.data.keys()][0]!, "{");
    await expect(store.read()).rejects.toMatchObject({ reason: "corrupt" });
    b.api.get = async () => {
      throw new Error("sensitive detail");
    };
    await expect(store.read()).rejects.toMatchObject({
      message: "storage",
      reason: "io",
    });
  });
});
