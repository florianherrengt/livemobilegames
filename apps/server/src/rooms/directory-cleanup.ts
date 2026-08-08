import type { Room } from "@colyseus/core";

import type { RoomDirectory } from "./room-directory.js";

/**
 * Hook a Colyseus room's onDispose so the directory entry is removed when the
 * room dies, but only while that entry still points at this room. This is the
 * narrowest supported way to keep the code mapping aligned without making game
 * rooms depend on the directory.
 */
export function attachDirectoryCleanup(room: Room, directory: RoomDirectory, code: string): void {
  const originalOnDispose = room.onDispose?.bind(room);
  room.onDispose = () => {
    directory.deleteByCodeIfMatchingRoom(code, room.roomId);
    return originalOnDispose?.();
  };
}
