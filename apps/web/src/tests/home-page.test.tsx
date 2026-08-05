import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "../routes/home-page.js";

const createRoomMock = vi.fn();
const joinRoomMock = vi.fn();

vi.mock("../api.js", () => ({
  ApiClientError: class ApiClientError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  apiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  api: {
    createRoom: (...args: unknown[]) => createRoomMock(...args),
    joinRoom: (...args: unknown[]) => joinRoomMock(...args),
  },
}));

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("home page", () => {
  beforeEach(() => {
    createRoomMock.mockReset();
    joinRoomMock.mockReset();
  });

  it("does not show a game catalogue before a room is created", () => {
    renderHome();
    expect(screen.queryByText("Game catalogue")).not.toBeInTheDocument();
    expect(screen.queryByText("No games are installed yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading games…")).not.toBeInTheDocument();
  });

  it("allows room creation before a game is chosen", () => {
    renderHome();
    expect(screen.getByRole("button", { name: "Create room" })).toBeEnabled();
  });

  it("validates the join form", async () => {
    renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Join room" }));
    expect(await screen.findByText("Enter a room code")).toBeInTheDocument();
  });

  it("normalises the room code to uppercase", () => {
    renderHome();
    const input = screen.getByLabelText("Room code");
    fireEvent.change(input, { target: { value: "abc123" } });
    expect(input).toHaveValue("ABC123");
  });

  it("prevents duplicate join submissions", async () => {
    joinRoomMock.mockReturnValue(new Promise(() => undefined));
    renderHome();
    fireEvent.change(screen.getByLabelText("Room code"), { target: { value: "ABC234" } });
    const nameInput = screen.getAllByLabelText("Your name")[1];
    if (nameInput === undefined) {
      throw new Error("Expected a join player name input");
    }
    fireEvent.change(nameInput, {
      target: { value: "Alice" },
    });
    const button = screen.getByRole("button", { name: "Join room" });
    fireEvent.click(button);
    await waitFor(() => expect(joinRoomMock).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    expect(joinRoomMock).toHaveBeenCalledTimes(1);
  });
});
