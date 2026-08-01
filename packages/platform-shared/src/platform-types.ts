export const CONNECTION_STATUSES = ["connected", "reconnecting", "disconnected"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const ROOM_STATUSES = ["lobby", "running", "finished", "closed"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];
