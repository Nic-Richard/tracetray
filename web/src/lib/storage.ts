// Browser storage can be blocked (private windows, strict settings), so every access is guarded.
export function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Nothing to save when storage is blocked.
  }
}

// Session storage clears when the browser closes, for things that should come back next visit.
export function readSession(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function writeSession(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch {
    // Nothing to save when storage is blocked.
  }
}
