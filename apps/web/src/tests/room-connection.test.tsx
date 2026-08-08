import type { ISeatReservation } from "@phone-party/protocol";
import { LobbyRoomState, ROOM_MESSAGE_TYPES } from "@phone-party/protocol";
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoomConnectionProvider, useRoomConnection } from "../game-connection.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

class FakeRoom {
  readonly state = new LobbyRoomState();
  readonly sessionId: string;
  readonly reconnectionToken: string;
  readonly leave = vi.fn(async () => undefined);
  readonly send = vi.fn((_type: string, _payload?: unknown) => undefined);
  readonly onStateChange = vi.fn((_listener: () => void) => () => undefined);
  readonly onMessage = vi.fn(
    (_type: string, listener: (messageType: string, payload: unknown) => void) => {
      this.messageListener = listener;
      return () => {
        if (this.messageListener === listener) {
          this.messageListener = undefined;
        }
      };
    },
  );
  readonly onLeave = {
    once: vi.fn((listener: () => void | Promise<void>) => {
      this.leaveListener = listener;
    }),
  };
  private messageListener: ((messageType: string, payload: unknown) => void) | undefined;
  private leaveListener: (() => void | Promise<void>) | undefined;

  constructor(
    readonly roomId: string,
    sessionId = `${roomId}-session`,
  ) {
    this.sessionId = sessionId;
    this.reconnectionToken = `${roomId}-token`;
  }

  emitMessage(messageType: string, payload: unknown): void {
    this.messageListener?.(messageType, payload);
  }

  async emitLeave(): Promise<void> {
    await this.leaveListener?.();
  }
}

const clientState = vi.hoisted(() => ({
  client: {
    consumeSeatReservation: vi.fn(),
    reconnect: vi.fn(),
  },
}));

vi.mock("../multiplayer.js", () => ({
  createColyseusClient: () => clientState.client,
}));

let currentConnect: ((code: string, reservation: ISeatReservation) => Promise<void>) | undefined;

function ConnectionHarness() {
  const { connection, connect } = useRoomConnection();
  useEffect(() => {
    currentConnect = connect;
    return () => {
      currentConnect = undefined;
    };
  }, [connect]);
  return (
    <div>
      <span data-testid="room-id">
        {(connection?.room as unknown as { roomId?: string })?.roomId ?? "none"}
      </span>
      <span data-testid="connection-status">
        {connection?.reconnecting === true ? "reconnecting" : "ready"}
      </span>
    </div>
  );
}

function reservation(name: string, roomId: string): ISeatReservation {
  return {
    name,
    roomId,
    sessionId: `${roomId}-session`,
  };
}

async function connect(reserved: ISeatReservation): Promise<void> {
  const connectRoom = currentConnect;
  if (connectRoom === undefined) {
    throw new Error("Connection harness is not ready");
  }
  await act(async () => {
    await connectRoom("ABC234", reserved);
  });
}

describe("RoomConnectionProvider async ownership", () => {
  beforeEach(() => {
    currentConnect = undefined;
    clientState.client.consumeSeatReservation.mockReset();
    clientState.client.reconnect.mockReset();
  });

  it("does not let a slower direct connection replace a newer one", async () => {
    const staleRoom = new FakeRoom("stale-room");
    const newerRoom = new FakeRoom("newer-room");
    const staleConnect = deferred<FakeRoom>();
    clientState.client.consumeSeatReservation.mockImplementation((reserved: ISeatReservation) =>
      reserved.roomId === staleRoom.roomId ? staleConnect.promise : Promise.resolve(newerRoom),
    );

    render(
      <RoomConnectionProvider>
        <ConnectionHarness />
      </RoomConnectionProvider>,
    );
    const connectRoom = currentConnect;
    if (connectRoom === undefined) {
      throw new Error("Connection harness is not ready");
    }
    const stalePromise = connectRoom("ABC234", reservation("__platform_lobby", staleRoom.roomId));
    await connect(reservation("__platform_lobby", newerRoom.roomId));

    await act(async () => {
      staleConnect.resolve(staleRoom);
      await expect(stalePromise).rejects.toThrow("superseded");
    });

    expect(screen.getByTestId("room-id")).toHaveTextContent(newerRoom.roomId);
    expect(staleRoom.leave).toHaveBeenCalledTimes(1);
    expect(newerRoom.leave).not.toHaveBeenCalled();
  });

  it("does not let a stale game transition replace a newer room", async () => {
    const originalLobby = new FakeRoom("original-lobby");
    const newerLobby = new FakeRoom("newer-lobby");
    const staleGame = new FakeRoom("stale-game");
    const transition = deferred<FakeRoom>();
    clientState.client.consumeSeatReservation.mockImplementation((reserved: ISeatReservation) => {
      if (reserved.roomId === originalLobby.roomId) {
        return Promise.resolve(originalLobby);
      }
      if (reserved.roomId === newerLobby.roomId) {
        return Promise.resolve(newerLobby);
      }
      return transition.promise;
    });

    render(
      <RoomConnectionProvider>
        <ConnectionHarness />
      </RoomConnectionProvider>,
    );
    await connect(reservation("__platform_lobby", originalLobby.roomId));

    act(() => {
      originalLobby.emitMessage(ROOM_MESSAGE_TYPES.transition, {
        gameId: "capital-pin",
        roomCode: "ABC234",
        reservation: reservation("capital-pin-room", staleGame.roomId),
      });
    });
    await connect(reservation("__platform_lobby", newerLobby.roomId));
    expect(screen.getByTestId("room-id")).toHaveTextContent(newerLobby.roomId);

    await act(async () => {
      transition.resolve(staleGame);
      await transition.promise;
      await Promise.resolve();
    });

    expect(screen.getByTestId("room-id")).toHaveTextContent(newerLobby.roomId);
    expect(newerLobby.leave).not.toHaveBeenCalled();
    expect(staleGame.leave).toHaveBeenCalledTimes(1);
  });

  it("finishes an in-flight game transition instead of reconnecting the dropped lobby", async () => {
    const originalLobby = new FakeRoom("transition-lobby");
    const reconnectedLobby = new FakeRoom("reconnected-lobby", originalLobby.sessionId);
    const gameRoom = new FakeRoom("transition-game");
    const transition = deferred<FakeRoom>();
    clientState.client.consumeSeatReservation.mockImplementation((reserved: ISeatReservation) =>
      reserved.roomId === originalLobby.roomId
        ? Promise.resolve(originalLobby)
        : transition.promise,
    );
    clientState.client.reconnect.mockResolvedValue(reconnectedLobby);

    render(
      <RoomConnectionProvider>
        <ConnectionHarness />
      </RoomConnectionProvider>,
    );
    await connect(reservation("__platform_lobby", originalLobby.roomId));
    act(() => {
      originalLobby.emitMessage(ROOM_MESSAGE_TYPES.transition, {
        gameId: "capital-pin",
        roomCode: "ABC234",
        reservation: reservation("capital-pin-room", gameRoom.roomId),
      });
    });

    await act(async () => {
      await originalLobby.emitLeave();
      transition.resolve(gameRoom);
      await transition.promise;
      await Promise.resolve();
    });

    expect(clientState.client.reconnect).not.toHaveBeenCalled();
    expect(screen.getByTestId("room-id")).toHaveTextContent(gameRoom.roomId);
    expect(gameRoom.leave).not.toHaveBeenCalled();
  });

  it("requests any pending transition after a lobby reconnect installs its listeners", async () => {
    const originalLobby = new FakeRoom("dropped-lobby");
    const reconnectedLobby = new FakeRoom("reconnected-lobby", originalLobby.sessionId);
    const gameRoom = new FakeRoom("resumed-game");
    clientState.client.consumeSeatReservation.mockImplementation((reserved: ISeatReservation) =>
      Promise.resolve(reserved.roomId === gameRoom.roomId ? gameRoom : originalLobby),
    );
    clientState.client.reconnect.mockResolvedValue(reconnectedLobby);

    render(
      <RoomConnectionProvider>
        <ConnectionHarness />
      </RoomConnectionProvider>,
    );
    await connect(reservation("__platform_lobby", originalLobby.roomId));

    await act(async () => {
      await originalLobby.emitLeave();
    });
    expect(screen.getByTestId("room-id")).toHaveTextContent(reconnectedLobby.roomId);
    expect(reconnectedLobby.send).toHaveBeenCalledWith(ROOM_MESSAGE_TYPES.resumeTransition, {});

    await act(async () => {
      reconnectedLobby.emitMessage(ROOM_MESSAGE_TYPES.transition, {
        gameId: "capital-pin",
        roomCode: "ABC234",
        reservation: reservation("capital-pin-room", gameRoom.roomId),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("room-id")).toHaveTextContent(gameRoom.roomId);
    expect(reconnectedLobby.leave).toHaveBeenCalledTimes(1);
  });

  it("closes a reconnect that resolves after the provider unmounts", async () => {
    const originalRoom = new FakeRoom("original-room");
    const reconnectedRoom = new FakeRoom("reconnected-room", originalRoom.sessionId);
    const reconnect = deferred<FakeRoom>();
    clientState.client.consumeSeatReservation.mockResolvedValue(originalRoom);
    clientState.client.reconnect.mockReturnValue(reconnect.promise);

    const rendered = render(
      <RoomConnectionProvider>
        <ConnectionHarness />
      </RoomConnectionProvider>,
    );
    await connect(reservation("__platform_lobby", originalRoom.roomId));

    act(() => {
      void originalRoom.emitLeave();
    });
    expect(screen.getByTestId("connection-status")).toHaveTextContent("reconnecting");
    rendered.unmount();

    await act(async () => {
      reconnect.resolve(reconnectedRoom);
      await reconnect.promise;
      await Promise.resolve();
    });

    expect(reconnectedRoom.leave).toHaveBeenCalledTimes(1);
  });
});
