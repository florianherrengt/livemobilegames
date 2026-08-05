import { useQuery } from "@tanstack/react-query";

import { api } from "../api.js";

export const gameQueryKeys = {
  all: ["games"] as const,
};

export function useGamesQuery() {
  return useQuery({
    queryKey: gameQueryKeys.all,
    queryFn: ({ signal }) => api.listGames(signal),
  });
}
