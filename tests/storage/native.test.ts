import { describe, expect, it } from "vitest";
import {
  Directory,
  Encoding,
  type FilesystemPlugin,
} from "@capacitor/filesystem";
import {
  createNativePrivateFiles,
  createNativePreferences,
} from "../../src/storage/native";
function backend() {
  const writes: unknown[] = [],
    reads: unknown[] = [];
  const api: Pick<FilesystemPlugin, "readFile" | "writeFile" | "readdir"> = {
    async readdir() {
      return { files: [] };
    },
    async readFile(options) {
      reads.push(options);
      return { data: "private body" };
    },
    async writeFile(options) {
      writes.push(options);
      return { uri: "private" };
    },
  };
  return { api, writes, reads };
}
describe("native-only private adapters", () => {
  it('lists only files in the private legacy directory without requesting public permissions', async () => {
    const b = backend(),
      calls: unknown[] = [];
    b.api.readdir = async (options) => {
      calls.push(options);
      return {
        files: [
          { name: 'v1-test.0.json', type: 'file', size: 1, mtime: 0, ctime: 0, uri: 'private' },
          { name: 'nested', type: 'directory', size: 0, mtime: 0, ctime: 0, uri: 'private' },
        ],
      };
    };
    const files = createNativePrivateFiles(b.api, () => 'android');
    expect(await files.list!('chapters')).toEqual(['v1-test.0.json']);
    expect(calls).toEqual([{ path: 'narou-reader/chapters', directory: Directory.LibraryNoCloud }]);
    await expect(files.list!('../secrets' as 'chapters')).rejects.toMatchObject({
      reason: 'invalid',
    });
    await expect(
      createNativePrivateFiles(b.api, () => 'web').list!('chapters'),
    ).rejects.toMatchObject({ reason: 'unsupported_platform' });
    expect(calls).toHaveLength(1);
  });
  it('treats only the explicit missing-directory code as an empty legacy library', async () => {
    const b = backend(),
      files = createNativePrivateFiles(b.api, () => 'android');
    b.api.readdir = async () => {
      throw { code: 'OS-PLUG-FILE-0008' };
    };
    expect(await files.list!('chapters')).toEqual([]);
    b.api.readdir = async () => {
      throw { code: 'OS-PLUG-FILE-0013', message: 'private detail' };
    };
    await expect(files.list!('chapters')).rejects.toMatchObject({
      reason: 'io',
      message: 'storage',
    });
  });
  it("uses app-private non-cloud Library files and utf8 without requesting public permissions", async () => {
    const b = backend(),
      files = createNativePrivateFiles(b.api, () => "android");
    await files.write("chapters/example.0.json", "body");
    expect(b.writes).toEqual([
      {
        path: "narou-reader/chapters/example.0.json",
        directory: Directory.LibraryNoCloud,
        encoding: Encoding.UTF8,
        data: "body",
        recursive: true,
      },
    ]);
    expect(await files.read("chapters/example.0.json")).toBe("private body");
    expect(b.reads).toEqual([
      {
        path: "narou-reader/chapters/example.0.json",
        directory: Directory.LibraryNoCloud,
        encoding: Encoding.UTF8,
      },
    ]);
  });
  it("recognizes only an explicit missing-file code as absent", async () => {
    const b = backend(),
      files = createNativePrivateFiles(b.api, () => "android");
    b.api.readFile = async () => {
      throw { code: "OS-PLUG-FILE-0008" };
    };
    expect(await files.read("chapters/a")).toBeNull();
    b.api.readFile = async () => {
      throw { code: "OS-PLUG-FILE-0007", message: "private detail" };
    };
    await expect(files.read("chapters/a")).rejects.toMatchObject({
      reason: "io",
      message: "storage",
    });
  });
  it("classifies wrapped ENOSPC errors without preserving their path or message", async () => {
    const b = backend(),
      files = createNativePrivateFiles(b.api, () => "android");
    b.api.writeFile = async () => {
      throw {
        code: "OS-PLUG-FILE-0013",
        message:
          "writeFile failed: secret-path: ENOSPC (No space left on device)",
      };
    };
    await expect(files.write("chapters/a", "body")).rejects.toMatchObject({
      reason: "disk_full",
      message: "storage",
    });
  });
  it("rejects web and traversal before touching the plugin", async () => {
    const b = backend();
    await expect(
      createNativePrivateFiles(b.api, () => "web").read("chapters/a"),
    ).rejects.toMatchObject({ reason: "unsupported_platform" });
    await expect(
      createNativePrivateFiles(b.api, () => "android").write(
        "../secrets",
        "body",
      ),
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(b.writes).toEqual([]);
    expect(b.reads).toEqual([]);
  });
  it("never uses web Preferences fallback", async () => {
    let calls = 0;
    const preferences = createNativePreferences(
      {
        async get() {
          calls++;
          return { value: null };
        },
        async set() {
          calls++;
        },
      },
      () => "web",
    );
    await expect(preferences.get({ key: "settings" })).rejects.toMatchObject({
      reason: "unsupported_platform",
    });
    await expect(
      preferences.set({ key: "settings", value: "data" }),
    ).rejects.toMatchObject({ reason: "unsupported_platform" });
    expect(calls).toBe(0);
  });
});
