export const MESSAGE = {
  setReady: "platform:set-ready",
  start: "platform:start",
  playAgain: "platform:play-again",
  gameCommand: "game:command",
  commandResult: "platform:command-result",
  error: "platform:error",
  timeSync: "platform:time-sync",
  matchFinished: "match:finished",
} as const;

export type MessageType = (typeof MESSAGE)[keyof typeof MESSAGE];
