import { ReaderError } from "../contracts";
export type StorageFailure =
  | "invalid"
  | "corrupt"
  | "unsupported_schema"
  | "disk_full"
  | "io"
  | "unsupported_platform"
  | "secure";
/** Never retain a plugin's exception message, path, data, or credential. */
export class StorageError extends ReaderError {
  constructor(readonly reason: StorageFailure) {
    super("storage");
    this.name = "StorageError";
  }
}
export function storageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  return new StorageError(
    code === "ENOSPC" || code === "EDQUOT" ? "disk_full" : "io",
  );
}
