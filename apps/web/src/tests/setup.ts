import "@testing-library/jest-dom/vitest";

const maplibreMock = vi.hoisted(() => {
  class MockMarker {
    lngLat: [number, number] = [0, 0];
    map: MockMap | null = null;

    constructor(readonly options: { element: HTMLElement }) {}

    setLngLat(lngLat: [number, number]): this {
      this.lngLat = lngLat;
      return this;
    }

    addTo(map: MockMap): this {
      this.map = map;
      map.markers.push(this);
      return this;
    }

    remove(): void {
      if (!this.map) {
        return;
      }
      const index = this.map.markers.indexOf(this);
      if (index >= 0) {
        this.map.markers.splice(index, 1);
      }
      this.map = null;
    }
  }

  class MockMap {
    readonly markers: MockMarker[] = [];
    readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    fitBoundsCalls = 0;
    static instances: MockMap[] = [];

    constructor(options: Record<string, unknown>) {
      void options;
      MockMap.instances.push(this);
      queueMicrotask(() => this.emit("load"));
    }

    addControl(): void {}

    on(type: string, listener: (...args: unknown[]) => void): void {
      const set = this.listeners.get(type) ?? new Set();
      set.add(listener);
      this.listeners.set(type, set);
    }

    off(type: string, listener: (...args: unknown[]) => void): void {
      this.listeners.get(type)?.delete(listener);
    }

    emit(type: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(...args);
      }
    }

    remove(): void {
      const index = MockMap.instances.indexOf(this);
      if (index >= 0) {
        MockMap.instances.splice(index, 1);
      }
    }

    getStyle(): { layers: unknown[] } {
      return { layers: [] };
    }

    isStyleLoaded(): boolean {
      return true;
    }

    setLayoutProperty(): void {}

    project(lngLat: [number, number]): { x: number; y: number } {
      return { x: lngLat[0], y: lngLat[1] };
    }

    fitBounds(): void {
      this.fitBoundsCalls += 1;
    }

    setCenter(): void {}

    setZoom(): void {}
  }

  return {
    Map: MockMap,
    Marker: MockMarker,
    NavigationControl: class NavigationControl {},
    instances: MockMap.instances,
  };
});

vi.mock("maplibre-gl", () => ({
  Map: maplibreMock.Map,
  Marker: maplibreMock.Marker,
  NavigationControl: maplibreMock.NavigationControl,
}));

export { maplibreMock };
