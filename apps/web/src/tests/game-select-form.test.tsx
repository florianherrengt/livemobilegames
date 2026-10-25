import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GameSelectForm } from "../components/game-select-form.js";

const games = [
  {
    id: "live-drawing-guessing",
    name: "Live Drawing & Guessing",
    description: "Draw a word for everyone to guess.",
    version: 1,
    minPlayers: 2,
    maxPlayers: 8,
    orientation: "portrait",
  },
] as const;

describe("drawing lobby language selection", () => {
  it("lets the host choose French and renders the authoritative selection", () => {
    const onSelectLanguage = vi.fn();
    const props = {
      games,
      selectedGameId: "live-drawing-guessing",
      isHost: true,
      language: "en" as const,
      onSelect: vi.fn(),
      onSelectLanguage,
    };
    const { rerender } = render(<GameSelectForm {...props} />);
    expect(screen.getByRole("combobox", { name: "Language / Langue" })).toHaveTextContent(
      "English",
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Language / Langue" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Français" }));
    expect(onSelectLanguage).toHaveBeenCalledWith("fr");
    rerender(<GameSelectForm {...props} language="fr" />);
    expect(screen.getByRole("combobox", { name: "Language / Langue" })).toHaveTextContent(
      "Français",
    );
  });

  it("shows guests the shared language without a selector and hides it for other games", () => {
    const props = {
      games,
      selectedGameId: "live-drawing-guessing",
      isHost: false,
      language: "fr" as const,
      onSelect: vi.fn(),
      onSelectLanguage: vi.fn(),
    };
    const { rerender } = render(<GameSelectForm {...props} />);
    expect(screen.getByText("Langue : Français")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    rerender(<GameSelectForm {...props} selectedGameId="capital-pin" isHost />);
    expect(screen.queryByLabelText("Language / Langue")).not.toBeInTheDocument();
  });
});
