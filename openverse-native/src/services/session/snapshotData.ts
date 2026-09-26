/** A Firestore document snapshot. `exists` is a method in current RNFirebase and a boolean in older builds. */
export interface SnapshotLike<T> {
  exists: boolean | (() => boolean);
  data(): T | undefined;
}

/** Reads a snapshot without treating a missing document and a failed read as the same thing. */
export function snapshotData<T>(snap: SnapshotLike<T> | null | undefined): T | null {
  if (!snap) return null;
  const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists === true;
  if (!exists) return null;
  return snap.data() ?? null;
}
