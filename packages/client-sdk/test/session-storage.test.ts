import { LocalStorageSessionStorage, MemorySessionStorage } from "@falling-platforms/client-sdk";
import { describe, expect, it } from "vitest";

class FakeLocalStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("MemorySessionStorage", () => {
  it("stores, loads and clears connection records", () => {
    const storage = new MemorySessionStorage();
    expect(storage.load()).toBeNull();

    const record = {
      serverUrl: "ws://localhost:2567",
      roomId: "ABCDE",
      roomName: "tap_race",
      reconnectToken: "token-1",
      updatedAt: 123,
    };
    storage.save(record);
    expect(storage.load()).toEqual(record);

    const rotated = { ...record, reconnectToken: "token-2", updatedAt: 456 };
    storage.save(rotated);
    expect(storage.load()?.reconnectToken).toBe("token-2");

    storage.clear();
    expect(storage.load()).toBeNull();
  });

  it("ignores malformed localStorage records", () => {
    const storage = new LocalStorageSessionStorage("test:connection");
    const fakeStorage = new FakeLocalStorage();
    fakeStorage.setItem("test:connection", "{not json");
    const previous = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: fakeStorage,
      configurable: true,
    });
    try {
      expect(storage.load()).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: previous,
        configurable: true,
      });
    }
  });
});
