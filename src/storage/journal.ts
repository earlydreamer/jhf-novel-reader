import { StorageError, storageError } from "./errors";
import { check, integer, object, record } from "./validation";
export interface PrivateFiles {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
interface Entry<T> {
  slot: number;
  generation: number;
  value: T;
}
/** A two-slot recovery journal. Never overwrite the newest valid slot. */
export class Journal {
  constructor(private readonly files: PrivateFiles) {}
  async load<T>(
    name: string,
    validate: (value: unknown) => Promise<T>,
  ): Promise<Entry<T> | null> {
    const entries: Entry<T>[] = [];
    let found = false;
    for (const slot of [0, 1]) {
      let raw: string | null;
      try {
        raw = await this.files.read(`${name}.${slot}.json`);
      } catch (error) {
        throw storageError(error);
      }
      if (raw === null) continue;
      found = true;
      try {
        const envelope: unknown = JSON.parse(raw);
        record(envelope);
        if (typeof envelope.format === "number" && envelope.format !== 1)
          throw new StorageError("unsupported_schema");
        object(envelope, ["format", "generation", "payload", "checksum"]);
        check(envelope.format === 1);
        integer(envelope.generation, 1);
        check(
          envelope.checksum ===
            (await digest([1, envelope.generation, envelope.payload])),
        );
        const value = await validate(envelope.payload);
        entries.push({ slot, generation: envelope.generation, value });
      } catch (error) {
        if (
          error instanceof StorageError &&
          error.reason === "unsupported_schema"
        )
          throw error;
      }
    }
    entries.sort((a, b) => b.generation - a.generation);
    if (!entries.length && found) throw new StorageError("corrupt");
    return entries[0] ?? null;
  }
  async loadForWrite<T>(
    name: string,
    validate: (value: unknown) => Promise<T>,
  ): Promise<Entry<T> | null> {
    try {
      return await this.load(name, validate);
    } catch (error) {
      // An explicit save can rebuild a fully corrupt record. Unknown schemas and I/O failures remain protected.
      if (error instanceof StorageError && error.reason === "corrupt")
        return null;
      throw error;
    }
  }
  async save<T>(
    name: string,
    value: T,
    validate: (value: unknown) => Promise<T>,
  ): Promise<void> {
    await validate(value);
    const previous = await this.loadForWrite(name, validate),
      generation = (previous?.generation ?? 0) + 1;
    integer(generation, 1);
    const slot = previous?.slot === 0 ? 1 : 0,
      path = `${name}.${slot}.json`;
    const raw = JSON.stringify({
      format: 1,
      generation,
      payload: value,
      checksum: await digest([1, generation, value]),
    });
    try {
      await this.files.write(path, raw);
      // Read-after-write verification catches partial writes before reporting ready.
      if ((await this.files.read(path)) !== raw) throw new StorageError("io");
    } catch (error) {
      throw storageError(error);
    }
  }
}
const queues = new WeakMap<PrivateFiles, Promise<unknown>>();
/** All repositories sharing an adapter share a queue, including separate factory calls. */
export function serial<T>(
  files: PrivateFiles,
  action: () => Promise<T>,
): Promise<T> {
  const task = (queues.get(files) ?? Promise.resolve()).then(action);
  queues.set(
    files,
    task.catch(() => {}),
  );
  return task;
}
