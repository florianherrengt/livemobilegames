import { type StoredConnection, storedConnectionSchema } from "@falling-platforms/platform-shared";

export interface SessionStorage {
  load(): StoredConnection | null;
  save(connection: StoredConnection): void;
  clear(): void;
}

export class LocalStorageSessionStorage implements SessionStorage {
  constructor(private readonly key: string) {}

  load(): StoredConnection | null {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const raw = localStorage.getItem(this.key);
    if (!raw) {
      return null;
    }
    try {
      const parsed = storedConnectionSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  save(connection: StoredConnection): void {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(this.key, JSON.stringify(connection));
    }
  }

  clear(): void {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(this.key);
    }
  }
}

export class MemorySessionStorage implements SessionStorage {
  private value: StoredConnection | null = null;

  load(): StoredConnection | null {
    return this.value;
  }

  save(connection: StoredConnection): void {
    this.value = connection;
  }

  clear(): void {
    this.value = null;
  }
}
