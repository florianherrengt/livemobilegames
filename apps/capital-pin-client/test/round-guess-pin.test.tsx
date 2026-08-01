import type {
  CapitalPinClientRoundResult,
  CapitalPinClientState,
  CapitalPinPhase,
} from "@falling-platforms/capital-pin";
import type { MultiplayerClient } from "@falling-platforms/client-sdk";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Results, Round } from "../src/main.js";

const registry = vi.hoisted(() => {
  type LngLat = [number, number];
  const maps: MockMap[] = [];

  class MockMarker {
    lngLat: LngLat = [0, 0];
    map: MockMap | null = null;

    constructor(readonly options: { element: HTMLElement }) {}

    setLngLat(lngLat: LngLat): this {
      this.lngLat = lngLat;
      return this;
    }

    addTo(map: MockMap): this {
      this.map = map;
      map.markers.push(this);
      return this;
    }

    remove(): void {
      if (!this.map) return;
      const index = this.map.markers.indexOf(this);
      if (index >= 0) {
        this.map.markers.splice(index, 1);
      }
      this.map = null;
    }
  }

  class MockMap {
    readonly markers: MockMarker[] = [];
    readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    fitBoundsCalls = 0;

    constructor(_options: Record<string, unknown>) {
      maps.push(this);
    }

    addControl(): void {}

    on(type: string, listener: (...args: unknown[]) => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
    }

    off(type: string, listener: (...args: unknown[]) => void): void {
      const list = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        list.filter((entry) => entry !== listener),
      );
    }

    remove(): void {
      this.markers.length = 0;
    }

    getStyle(): { layers: unknown[] } {
      return { layers: [] };
    }

    isStyleLoaded(): boolean {
      return true;
    }

    setLayoutProperty(): void {}

    fitBounds(): void {
      this.fitBoundsCalls += 1;
    }

    setCenter(): void {}

    setZoom(): void {}
  }

  return {
    MockMap,
    MockMarker,
    NavigationControl: class NavigationControl {},
    maps,
  };
});

vi.mock("maplibre-gl", () => ({
  default: {
    Map: registry.MockMap,
    Marker: registry.MockMarker,
    NavigationControl: registry.NavigationControl,
  },
}));

vi.mock("@falling-platforms/capital-pin", () => ({
  formatDistanceKm: (distanceKm: number) => `${distanceKm} km`,
}));

vi.mock("@falling-platforms/client-sdk", () => ({
  MultiplayerClient: class MultiplayerClient {},
}));

function makeState(
  options: {
    submitted?: boolean;
    phase?: CapitalPinPhase;
    lastResult?: CapitalPinClientRoundResult | null;
  } = {},
): CapitalPinClientState {
  const { submitted = false, phase = "round", lastResult = null } = options;
  return {
    roomCode: "ABCDE",
    gameId: "capital_pin",
    status: "running",
    hostSessionId: "me",
    phase,
    roundNumber: lastResult?.roundNumber ?? 1,
    totalRounds: 10,
    roundEndsAt: Date.now() + 60_000,
    resultsEndsAt: 0,
    currentCapitalName: "Paris",
    lastResult,
    result: null,
    players: new Map([
      [
        "me",
        {
          name: "Alice",
          connectionStatus: "connected",
          isHost: true,
          isReady: true,
          roundWins: 0,
          totalDistanceKm: 0,
          submitted,
        },
      ],
    ]),
  };
}

function makeClient(): MultiplayerClient<CapitalPinClientState, never> {
  return {
    getEstimatedServerTime: () => Date.now(),
    sendGameCommand: vi.fn(),
  } as unknown as MultiplayerClient<CapitalPinClientState, never>;
}

function roundResult(): CapitalPinClientRoundResult {
  return {
    roundNumber: 1,
    capitalName: "Paris",
    country: "France",
    correctLatitude: 48.8566,
    correctLongitude: 2.3522,
    winnerSessionIds: ["me"],
    guesses: [
      {
        sessionId: "me",
        displayName: "Alice",
        latitude: 48.85,
        longitude: 2.35,
        distanceKm: 0.8,
        isWinner: true,
      },
      {
        sessionId: "bob",
        displayName: "Bob",
        latitude: 40,
        longitude: 0,
        distanceKm: 1_110,
        isWinner: false,
      },
    ],
  };
}

describe("capital-pin map screens", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: MultiplayerClient<CapitalPinClientState, never>;
  let map: InstanceType<typeof registry.MockMap>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    registry.maps.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = makeClient();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function render(element: ReactNode): Promise<void> {
    await act(async () => {
      root.render(element);
    });
    const created = registry.maps[0];
    if (!created) {
      throw new Error("GameMap did not create a map");
    }
    map = created;
  }

  async function clickMap(lng: number, lat: number): Promise<void> {
    await act(async () => {
      for (const listener of map.listeners.get("click") ?? []) {
        listener({ lngLat: { lng, lat } });
      }
    });
  }

  async function fireMapLoad(): Promise<void> {
    await act(async () => {
      for (const listener of map.listeners.get("load") ?? []) {
        listener();
      }
    });
  }

  describe("round guess pin", () => {
    it("shows the locked player's own pin once the map is ready", async () => {
      // The player drops the pin and locks while the map style is still loading.
      await render(<Round client={client} state={makeState()} selfSessionId="me" />);
      await clickMap(2.3522, 48.8566);
      await render(
        <Round client={client} state={makeState({ submitted: true })} selfSessionId="me" />,
      );
      await fireMapLoad();

      expect(map.markers).toHaveLength(1);
      expect(map.markers[0]?.lngLat).toEqual([2.3522, 48.8566]);
    });

    it("keeps exactly one pin at the guess position after locking", async () => {
      await render(<Round client={client} state={makeState()} selfSessionId="me" />);
      await fireMapLoad();
      await clickMap(2.3522, 48.8566);

      // A timer-tick re-render while the guess is placed must not duplicate the pin.
      await render(<Round client={client} state={makeState()} selfSessionId="me" />);
      expect(map.markers).toHaveLength(1);
      expect(map.markers[0]?.lngLat).toEqual([2.3522, 48.8566]);

      // The pin stays visible (and unique) once the answer is locked.
      await render(
        <Round client={client} state={makeState({ submitted: true })} selfSessionId="me" />,
      );
      expect(map.markers).toHaveLength(1);
      expect(map.markers[0]?.lngLat).toEqual([2.3522, 48.8566]);
      expect(container.textContent).toContain("Answer locked");
    });
  });

  describe("results screen", () => {
    it("renders the map with the capital and every revealed guess", async () => {
      await render(
        <Results state={makeState({ phase: "round-results", lastResult: roundResult() })} />,
      );

      // The results screen must mount its own map once the round map is gone.
      expect(registry.maps).toHaveLength(1);
      await fireMapLoad();

      expect(map.fitBoundsCalls).toBeGreaterThan(0);
      expect(map.markers).toHaveLength(3);
      expect(map.markers.map((marker) => marker.lngLat)).toEqual([
        [2.3522, 48.8566],
        [2.35, 48.85],
        [0, 40],
      ]);
    });
  });
});
