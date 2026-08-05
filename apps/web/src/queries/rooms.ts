import type { CreateRoomRequest, ISeatReservation, JoinRoomRequest } from "@phone-party/protocol";
import { useMutation } from "@tanstack/react-query";

import { api } from "../api.js";

type RoomConnector = (code: string, reservation: ISeatReservation) => Promise<void>;

export function useCreateRoomMutation(connect: RoomConnector) {
  return useMutation({
    mutationFn: async (input: CreateRoomRequest) => {
      const result = await api.createRoom(input);
      await connect(result.room.code, result.reservation);
      return result;
    },
  });
}

export function useJoinRoomMutation(connect: RoomConnector) {
  return useMutation({
    mutationFn: async ({ code, input }: { code: string; input: JoinRoomRequest }) => {
      const result = await api.joinRoom(code, input);
      await connect(result.room.code, result.reservation);
      return result;
    },
  });
}
