import type { Room as SDKRoom } from "@colyseus/sdk";
import type { ColyseusTestServer } from "@colyseus/testing";
import type { Room as ColyseusRoom } from "colyseus";

import { waitFor } from "./wait-for.js";

export class FakeClient<TState = unknown> {
  constructor(
    private readonly server: ColyseusTestServer,
    private readonly room: SDKRoom<ColyseusRoom, TState>,
  ) {}

  get sessionId(): string {
    return this.room.sessionId;
  }

  get state(): TState {
    return this.room.state;
  }

  get reconnectionToken(): string {
    return this.room.reconnectionToken;
  }

  send(type: string, payload?: unknown): void {
    this.room.send(type, payload);
  }

  waitForMessage<T = unknown>(type: string, timeoutMs?: number): Promise<T> {
    return this.room.waitForMessage(type, timeoutMs ?? 15_000);
  }

  async waitFor(predicate: () => boolean, description: string, timeoutMs?: number): Promise<void> {
    await waitFor(predicate, description, timeoutMs);
  }

  disconnect(): void {
    this.room.connection.close();
  }

  async reconnect(): Promise<FakeClient<TState>> {
    const room = await this.server.sdk.reconnect<TState>(this.room.reconnectionToken);
    return new FakeClient<TState>(this.server, room);
  }

  async leave(): Promise<void> {
    await this.room.leave();
  }
}
