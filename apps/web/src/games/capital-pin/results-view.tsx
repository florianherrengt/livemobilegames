import { Box, List, ListItem, Paper, Typography } from "@mui/material";
import { type CapitalPinState, formatDistanceKm } from "@phone-party/protocol";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { geoPinSounds } from "./audio/GeoPinSounds.js";
import { computeResultsCamera, type Point } from "./map/camera.js";
import { MapMarker } from "./map/map-marker.js";
import { GameMap, useMap } from "./map/map-view.js";
import { getPlayerColour } from "./map/markers.js";

const MAX_AUDIO_DISTANCE_KM = 5_000;

export function ResultsView({
  state,
  selfSessionId,
}: {
  state: CapitalPinState;
  selfSessionId: string;
}) {
  const result = state.lastResult;

  const points: Point[] = useMemo(() => {
    if (!result) {
      return [];
    }
    return [
      { latitude: result.correctLatitude, longitude: result.correctLongitude },
      ...result.guesses.map((guess) => ({
        latitude: guess.latitude,
        longitude: guess.longitude,
      })),
    ];
  }, [result]);

  return (
    <Box
      component="main"
      sx={{ display: "flex", flexDirection: "column", height: "100dvh", width: "100%" }}
    >
      <GameMap interactive={false}>
        <ResultsMapContent result={result} points={points} selfSessionId={selfSessionId} />
      </GameMap>
      <Paper square sx={{ maxHeight: "45%", overflow: "auto", p: 2 }}>
        <Typography component="h2" variant="h2" sx={{ mt: 0 }}>
          Round {result?.roundNumber ?? ""}: {result?.capitalName ?? ""}
        </Typography>
        <List disablePadding sx={{ mt: 1 }}>
          {(result?.guesses ?? [])
            .slice()
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .map((guess) => (
              <ListItem
                key={guess.sessionId}
                disableGutters
                sx={{
                  gap: 1,
                  borderRadius: 1,
                  outline: guess.isWinner ? "2px solid" : "none",
                  outlineColor: "primary.main",
                  px: 1,
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    bgcolor: getPlayerColour(guess.sessionId),
                  }}
                />
                <Typography sx={{ flex: 1 }}>{guess.displayName}</Typography>
                <Typography color="text.secondary">{formatDistanceKm(guess.distanceKm)}</Typography>
                {guess.isWinner && <Typography color="primary.main">winner</Typography>}
              </ListItem>
            ))}
        </List>
      </Paper>
    </Box>
  );
}

function ResultsMapContent({
  result,
  points,
  selfSessionId,
}: {
  result: CapitalPinState["lastResult"];
  points: Point[];
  selfSessionId: string;
}) {
  const map = useMap();
  const playedRoundRef = useRef(0);
  const soundTimersRef = useRef<number[]>([]);

  useEffect(() => {
    if (!map || !result || playedRoundRef.current === result.roundNumber) {
      return;
    }
    playedRoundRef.current = result.roundNumber;

    void geoPinSounds.initialise();
    geoPinSounds.answerReveal();

    const selfGuess = result.guesses.find((guess) => guess.sessionId === selfSessionId);
    if (selfGuess) {
      const accuracy = Math.max(0, Math.min(1, 1 - selfGuess.distanceKm / MAX_AUDIO_DISTANCE_KM));
      soundTimersRef.current.push(window.setTimeout(() => geoPinSounds.scoreResult(accuracy), 350));
    }
    if (result.winnerSessionIds.includes(selfSessionId)) {
      soundTimersRef.current.push(window.setTimeout(() => geoPinSounds.roundWin(), 850));
    }
  }, [map, result, selfSessionId]);

  useEffect(() => {
    const timers = soundTimersRef.current;
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    if (!map || points.length === 0) {
      return;
    }
    const isMobile = window.innerWidth < 640;
    const camera = computeResultsCamera(points, isMobile);
    if (camera.kind === "fitBounds") {
      map.fitBounds(camera.bounds, { padding: camera.padding, maxZoom: camera.maxZoom });
    } else {
      map.setCenter(camera.center);
      map.setZoom(camera.zoom);
    }
  }, [map, points]);

  if (!map || !result) {
    return null;
  }
  return (
    <>
      <MapMarker
        longitude={result.correctLongitude}
        latitude={result.correctLatitude}
        label="★"
        colour="#111"
      />
      {result.guesses.map((guess) => (
        <MapMarker
          key={guess.sessionId}
          longitude={guess.longitude}
          latitude={guess.latitude}
          label={guess.displayName.slice(0, 1)}
          colour={getPlayerColour(guess.sessionId)}
        />
      ))}
      <GuessConnectionLines map={map} result={result} selfSessionId={selfSessionId} />
    </>
  );
}

/**
 * Draws a line from every revealed guess to the capital once the results map
 * appears, then animates each line in with a short travelling dash. The sound
 * for the local player's line is played alongside its animation.
 */
function GuessConnectionLines({
  map,
  result,
  selfSessionId,
}: {
  map: MapLibreMap;
  result: NonNullable<CapitalPinState["lastResult"]>;
  selfSessionId: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [animate, setAnimate] = useState(false);
  const playedRoundRef = useRef(0);
  const animationRef = useRef({ frame: 0, timer: 0 });

  useEffect(() => {
    if (typeof map.project !== "function") {
      return;
    }
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const draw = (): void => {
      const answer = map.project([result.correctLongitude, result.correctLatitude]);
      result.guesses.forEach((guess, index) => {
        const line = svg.querySelector<SVGLineElement>(`[data-line-index="${index}"]`);
        if (!line) {
          return;
        }
        const point = map.project([guess.longitude, guess.latitude]);
        line.setAttribute("x1", String(point.x));
        line.setAttribute("y1", String(point.y));
        line.setAttribute("x2", String(answer.x));
        line.setAttribute("y2", String(answer.y));
      });
    };

    map.on("move", draw);
    map.on("zoom", draw);
    map.on("resize", draw);
    draw();

    return () => {
      map.off("move", draw);
      map.off("zoom", draw);
      map.off("resize", draw);
    };
  }, [map, result]);

  useEffect(() => {
    if (typeof map.project !== "function" || playedRoundRef.current === result.roundNumber) {
      return;
    }
    playedRoundRef.current = result.roundNumber;

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setAnimate(true);
      return;
    }

    const selfIndex = result.guesses.findIndex((guess) => guess.sessionId === selfSessionId);
    const selfGuess = selfIndex >= 0 ? result.guesses[selfIndex] : undefined;
    const show = (): void => {
      setAnimate(true);
      if (selfGuess) {
        const progress = Math.min(1, selfGuess.distanceKm / MAX_AUDIO_DISTANCE_KM);
        animationRef.current.timer = window.setTimeout(
          () => geoPinSounds.connectionWhoosh(progress),
          selfIndex * 120,
        );
      }
    };
    if (typeof window.requestAnimationFrame === "function") {
      animationRef.current.frame = window.requestAnimationFrame(show);
    } else {
      show();
    }
  }, [map, result, selfSessionId]);

  useEffect(() => {
    return () => {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationRef.current.frame);
      }
      window.clearTimeout(animationRef.current.timer);
    };
  }, []);

  if (typeof map.project !== "function" || result.guesses.length === 0) {
    return null;
  }

  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <svg ref={svgRef} className="cp-guess-lines" aria-hidden="true">
      {result.guesses.map((guess, index) => (
        <line
          key={guess.sessionId}
          data-line-index={index}
          className="cp-guess-line"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={animate ? 0 : 1}
          style={{
            transition: prefersReducedMotion
              ? "none"
              : `stroke-dashoffset 0.6s linear ${index * 0.12}s`,
          }}
        />
      ))}
    </svg>
  );
}
