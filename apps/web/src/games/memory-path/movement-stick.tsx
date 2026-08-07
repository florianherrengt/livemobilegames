import { Box, Typography } from "@mui/material";
import { useRef, useState } from "react";

import { gameFeedback, primeGameFeedback } from "../../feedback.js";

const KNOB_DIAMETER = 56;
const BASE_DIAMETER = 148;

/**
 * Continuous two-dimensional mobile movement control. The player drags the
 * knob; the component emits raw joystick vectors in [-1, 1]. The server
 * normalises diagonals and owns all movement outcomes.
 */
export function MovementStick({
  enabled,
  onMove,
  onRelease,
}: {
  enabled: boolean;
  onMove: (x: number, y: number) => void;
  onRelease: () => void;
}) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const updateFromPointer = (clientX: number, clientY: number): void => {
    const base = baseRef.current;
    if (!base) {
      return;
    }
    const rect = base.getBoundingClientRect();
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    const dx = clientX - centreX;
    const dy = clientY - centreY;
    const maxTravel = Math.max(1, rect.width / 2 - KNOB_DIAMETER / 2);
    const magnitude = Math.hypot(dx, dy);
    const scale = magnitude === 0 ? 0 : Math.min(1, magnitude / maxTravel);
    const vectorX = magnitude === 0 ? 0 : (dx / magnitude) * scale;
    const vectorY = magnitude === 0 ? 0 : (dy / magnitude) * scale;
    setOffset({ x: vectorX * maxTravel, y: vectorY * maxTravel });
    onMove(vectorX, vectorY);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!enabled) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    primeGameFeedback();
    gameFeedback("move");
    updateFromPointer(event.clientX, event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) {
      return;
    }
    updateFromPointer(event.clientX, event.clientY);
  };

  const finishDrag = (): void => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    setOffset({ x: 0, y: 0 });
    onRelease();
  };

  return (
    <Box
      ref={baseRef}
      role="group"
      aria-label="Movement joystick"
      data-testid="memory-path-joystick"
      data-enabled={enabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      sx={{
        position: "relative",
        width: BASE_DIAMETER,
        height: BASE_DIAMETER,
        borderRadius: "50%",
        bgcolor: "rgba(255, 255, 255, 0.08)",
        border: "1px solid rgba(255, 255, 255, 0.22)",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        opacity: enabled ? 1 : 0.45,
        transition: "opacity 120ms ease",
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 1,
          height: "70%",
          bgcolor: "rgba(255, 255, 255, 0.16)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          height: 1,
          width: "70%",
          bgcolor: "rgba(255, 255, 255, 0.16)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: KNOB_DIAMETER,
          height: KNOB_DIAMETER,
          borderRadius: "50%",
          bgcolor: enabled ? "primary.main" : "grey.600",
          border: "3px solid rgba(255, 255, 255, 0.75)",
          transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
          pointerEvents: "none",
          boxShadow: "0 2px 10px rgba(0, 0, 0, 0.35)",
        }}
      />
      <Typography
        variant="caption"
        aria-hidden
        sx={{
          position: "absolute",
          bottom: -26,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "text.secondary",
        }}
      >
        Drag to move
      </Typography>
    </Box>
  );
}
