import { LobbyPlayerState, LobbyRoomState } from "@phone-party/protocol";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayerList } from "../components/player-list.js";

describe("PlayerList", () => {
  it("renders players with host and self markers", () => {
    const state = new LobbyRoomState();
    const alice = new LobbyPlayerState();
    alice.playerId = "player-a";
    alice.name = "Alice";
    alice.isHost = true;
    const bob = new LobbyPlayerState();
    bob.playerId = "player-b";
    bob.name = "Bob";
    state.players.set("session-a", alice);
    state.players.set("session-b", bob);

    render(<PlayerList players={state.players} selfSessionId="session-a" />);

    expect(screen.getByText(/Players \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/\(you\)/)).toBeInTheDocument();
    expect(screen.getByText(/host/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });
});
