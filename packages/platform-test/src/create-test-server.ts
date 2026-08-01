import type { Room as SDKRoom } from "@colyseus/sdk";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room } from "colyseus";

import { FakeClient } from "./fake-client.js";
import { waitFor } from "./wait-for.js";

export type TestAppConfig = Parameters<typeof boot>[0];

export async function createTestServer(appConfig: TestAppConfig): Promise<ColyseusTestServer> {
  return boot(appConfig);
}

export async function connectTestClient<TState = unknown>(
  server: ColyseusTestServer,
  room: Room,
  options: unknown,
): Promise<FakeClient<TState>> {
  const client = await server.connectTo(room, options);
  return new FakeClient<TState>(server, client as unknown as SDKRoom<Room, TState>);
}

export { waitFor };
