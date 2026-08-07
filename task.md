# Build the Live Drawing and Guessing Mini-Game

Implement a simple phone-only multiplayer drawing and guessing game.

One player draws a randomly assigned word on their phone. Every other player sees the drawing appear live on their own phone and tries to guess the word. The first player to guess correctly earns a point, and the player drawing also earns a point.

Keep the game deliberately simple. Do not add extra modes, power-ups, teams, word selection, difficulty settings, reactions, public guesses, drawing replays, achievements, or complicated scoring.

The game must support between 2 and 8 players.

---

# Core Game Rules

Each player draws exactly three times during the game.

The game therefore contains:

```text
total turns = number of players × 3
```

Examples:

```text
2 players = 6 turns
4 players = 12 turns
8 players = 24 turns
```

The game may take a long time with many players. That is acceptable. Do not shorten the game automatically based on player count.

Each turn lasts for a maximum of 60 seconds.

During a turn:

1. One player is the drawer.
2. The drawer receives one random word.
3. The drawer draws the word using their finger.
4. All other players see the drawing live.
5. Guessers see the word category and the exact number of letters.
6. Letters are gradually revealed during the turn.
7. Players submit private guesses.
8. The first correct guess immediately ends the turn.
9. The first correct guesser receives 1 point.
10. The drawer receives 1 point.
11. All other players receive 0 points.
12. If nobody guesses correctly within 60 seconds, the turn ends and nobody receives points.

Only the first correct guess counts.

Do not allow multiple guessers to score during the same turn.

---

# Game Start

The host can start the game when there are between 2 and 8 active players in the room.

When the game starts:

1. Freeze the list of participating players.
2. Randomise the player order once.
3. Use that same order for all three drawing rounds.
4. Start round one with the first player in the order.

Each round contains one drawing turn for every participating player.

Example with four players:

```text
Round 1:
Alice draws
Ben draws
Claire draws
Daniel draws

Round 2:
Alice draws
Ben draws
Claire draws
Daniel draws

Round 3:
Alice draws
Ben draws
Claire draws
Daniel draws
```

After the final player completes their third drawing turn, the game ends.

Players who join after the game has started must not be added to the current drawing order. They may spectate the current game and participate when a new game starts.

---

# Drawer Selection

The drawer is determined automatically by the current position in the turn order.

Players do not vote for the drawer.

Players cannot volunteer to draw.

Players cannot swap drawing turns.

Players cannot skip a word voluntarily.

The same player must not draw twice in a row unless all other players are unavailable because they disconnected.

---

# Word Assignment

At the beginning of each turn, assign the drawer one random word.

The drawer must not choose between multiple words.

There is:

- No word selection screen.
- No reroll button.
- No skip-word button.
- No difficulty selection.
- No word voting.

The assigned word is shown only to the drawer.

Other players must never receive the complete answer before the turn ends.

Avoid using the same word more than once during the same game unless the available word pool has been exhausted.

---

# Word Preparation Phase

Before the 60-second drawing timer begins, give the drawer a short preparation phase.

Use a three-second countdown.

During these three seconds:

## Drawer sees

- The assigned word.
- The category.
- A countdown from 3 to 1.
- The drawing canvas, but drawing is not active yet.

## Guessers see

- The name of the player who is about to draw.
- A message such as:

```text
Alice is getting ready
```

- The category may remain hidden until the drawing begins.
- They must not see the answer or letter pattern yet.
- They cannot submit guesses yet.

When the preparation countdown finishes:

1. Activate the drawing canvas.
2. Show the category and letter pattern to guessers.
3. Enable the guess input.
4. Start the 60-second timer.
5. Begin sending drawing strokes live.

---

# Word Categories

Every word must belong to one simple category.

Use broad categories that help players without making the answer obvious.

Suitable categories include:

- Animal
- Food
- Object
- Place
- Nature
- Person
- Action
- Transport

Do not create overly specific categories such as:

- African animal
- Kitchen appliance
- European capital
- Water-based transport

The category should provide a useful general clue, not almost reveal the answer.

Display the category clearly throughout the turn.

Example:

```text
Category: Animal
```

---

# Word List Requirements

The quality of the word list is important because the game uses exact-answer matching.

Every word should be:

- Easy to understand.
- Reasonably easy to draw.
- Commonly known.
- Easy to spell.
- Associated with one obvious name.
- Appropriate for general audiences.
- Recognisable without needing written labels.
- Suitable for players using a phone keyboard.

Prefer words containing between 4 and 12 letters, excluding spaces.

Simple two-word answers are allowed, but use them sparingly.

Examples of suitable words:

```text
banana
castle
giraffe
rocket
spider
pirate
rainbow
camera
volcano
penguin
ice cream
traffic light
```

Avoid words that commonly have several equally valid names.

Examples to avoid:

```text
sofa
```

A player may reasonably call it `couch`.

```text
mobile phone
```

A player may type `phone`, `mobile`, `cell phone`, or `smartphone`.

```text
aeroplane
```

Some players may spell it `airplane`.

```text
chips
```

Its meaning depends on the player’s country.

Also avoid:

- Brand names.
- Celebrity names.
- Obscure fictional characters.
- Technical terms.
- Abstract emotions.
- Slang.
- Regional vocabulary.
- Words with disputed spellings.
- Answers that naturally require an alias.
- Words that are difficult to represent visually.
- Very short words.
- Extremely long words.
- Plural words unless the plural itself is clearly necessary.

The game must have one canonical answer for each word.

Do not store or accept aliases.

---

# Letter Pattern

At the start of the drawing phase, guessers see the exact structure of the answer.

Each unrevealed letter appears as an underscore.

Example:

```text
GIRAFFE

_ _ _ _ _ _ _
```

For two-word answers, show spaces immediately.

Example:

```text
ICE CREAM

_ _ _   _ _ _ _ _
```

For words containing a hyphen or apostrophe, show that punctuation immediately.

However, avoid such words in the initial word list when possible.

The drawer may see the complete answer rather than the hidden-letter pattern.

---

# Progressive Letter Reveals

Letters must appear progressively and at evenly spaced intervals during the 60-second turn.

The reveal timing must be based on the total number of letters in the answer.

Count only alphabetical letters.

Do not count:

- Spaces.
- Hyphens.
- Apostrophes.
- Other punctuation.

The game should reveal every letter except one over the duration of the turn.

The final hidden letter must never be revealed automatically. This ensures that players must still submit the answer rather than simply wait for the entire word to appear.

Use this rule:

```text
reveal interval = 60 seconds ÷ total number of letters
```

Reveal one letter after every interval.

Stop after revealing `total number of letters - 1`.

Example for a six-letter word:

```text
Interval: 60 ÷ 6 = 10 seconds

10 seconds: reveal one letter
20 seconds: reveal one letter
30 seconds: reveal one letter
40 seconds: reveal one letter
50 seconds: reveal one letter

One letter remains hidden.
```

Example for a ten-letter word:

```text
Interval: 60 ÷ 10 = 6 seconds

Reveal one letter every 6 seconds.
Stop after revealing 9 letters.
```

Select the reveal order randomly when the turn starts.

Do not reveal letters from left to right.

Do not always reveal the first letter first.

Do not always leave the last letter hidden.

Each letter position must be treated independently.

When a word contains repeated letters, revealing one position must not automatically reveal every matching letter.

Example:

```text
Answer: BANANA
```

Revealing the first `A` only reveals that specific position:

```text
_ A _ _ _ _
```

It must not reveal all three `A` positions.

The reveal order must remain fixed for the duration of the turn. Do not randomise it again after each reveal.

If the turn ends early because someone guesses correctly, stop all remaining letter reveals immediately.

---

# Drawing

The drawer draws directly on a large touch canvas using one finger.

Drawing must appear live on every guesser’s phone.

The drawer’s own strokes should appear immediately on their local canvas.

The drawing tools must remain minimal.

Provide:

- One fixed brush size.
- A small colour palette.
- An undo button.

Use black as the default selected colour.

A suitable palette is:

- Black
- Red
- Blue
- Green
- Yellow
- Orange
- Purple
- Brown

Do not add:

- Multiple brush types.
- Adjustable brush-size sliders.
- Fill tools.
- Shape tools.
- Text tools.
- Image uploads.
- Stickers.
- Background selection.
- Layers.
- Zooming.
- Panning.
- An eraser.
- A replay editor.

Undo should remove the drawer’s most recent complete stroke.

A stroke means one continuous finger-down to finger-up action.

Undo must not remove individual coordinate points one at a time.

Allow repeated undo operations until there are no strokes remaining.

Disable undo when there is nothing left to undo.

Undo changes must appear live for all guessers.

The drawer must not be able to draw during:

- The preparation countdown.
- The result screen.
- Another player’s turn.
- The final scoreboard.

Prevent the page itself from scrolling while the drawer is drawing.

Ignore additional touch points while a drawing stroke is in progress.

The drawer should not accidentally zoom the page or trigger browser gestures while drawing.

---

# Drawing Rules

The drawer should be told:

```text
Draw the word. Do not write letters or numbers.
```

This is a social rule.

Do not attempt to automatically detect whether the drawer has written letters or numbers.

Do not add reporting, voting, punishment, or automated handwriting recognition in the initial version.

---

# Guesser Screen

Every non-drawing player sees:

- The drawer’s name.
- The live drawing.
- The category.
- The current hidden-letter pattern.
- The remaining time.
- A text field for entering a guess.
- A submit action.

The drawing should occupy most of the available screen.

The guess input should remain usable while the mobile keyboard is open.

After a wrong guess:

1. Show brief private feedback such as `Incorrect`.
2. Clear the input.
3. Keep the input focused.
4. Allow the player to guess again immediately.

Players may submit unlimited guesses until:

- Someone guesses correctly.
- The timer reaches zero.
- The player disconnects.
- The turn otherwise ends.

Do not add cooldowns or penalties for incorrect guesses.

Players are allowed to guess before the drawer has made the first stroke.

---

# Guess Privacy

All guesses are private.

A player must only see the guesses they personally submitted.

Other guessers must not see:

- Wrong guesses.
- Correct guesses.
- Guess history.
- Near misses.
- Suggestions based on other players’ guesses.

The drawer must not see submitted guesses either.

The drawer should only know that nobody has guessed yet until the turn ends.

Do not show a public message whenever someone enters a wrong answer.

Because the first correct guess ends the turn immediately, there is no need to show a message such as `Alice has guessed correctly` during an active turn.

Instead, transition directly to the result screen.

---

# Guess Matching

The answer uses exact matching after minimal normalisation.

Normalise both the submitted guess and the canonical answer by:

1. Converting to lowercase.
2. Removing spaces from the beginning and end.
3. Replacing repeated internal spaces with one space.

Example:

```text
Answer: ice cream
```

Accept:

```text
ice cream
Ice Cream
  ice cream
ice  cream
```

Do not accept:

```text
icecream
cream
ice
frozen dessert
```

Do not implement:

- Aliases.
- Synonyms.
- Singular-to-plural conversion.
- Plural-to-singular conversion.
- Spellchecking.
- Fuzzy matching.
- Edit-distance matching.
- Typo tolerance.
- Accent substitution.
- AI-based answer judging.
- Semantic similarity.
- Common spelling variants.

Example:

```text
Answer: giraffe
```

Accept:

```text
giraffe
GIRAFFE
Giraffe
```

Reject:

```text
girafe
giraffes
animal
long neck
```

The exact number of letters is visible, so players are expected to enter the exact answer.

---

# First Correct Guess

The first valid correct guess received during the active turn wins.

As soon as a correct guess is accepted:

1. Stop accepting guesses.
2. Stop the timer.
3. Stop letter reveals.
4. Stop drawing input.
5. Record the winning guesser.
6. Award 1 point to the guesser.
7. Award 1 point to the drawer.
8. Transition to the result screen.

When two correct guesses arrive extremely close together, only one player scores.

Use the authoritative order in which the valid guesses are accepted.

Do not award shared points.

Do not declare a tie for the turn.

Any correct guess received after the first accepted correct guess must be ignored.

---

# Timeout

If no correct guess has been accepted when the 60-second timer ends:

1. Stop drawing.
2. Stop accepting guesses.
3. Stop letter reveals.
4. Award no points.
5. Transition to the result screen.

The drawer receives no point.

All guessers receive no point.

Do not award partial points for close guesses.

Do not extend the timer.

Do not offer another clue.

Do not let the drawer continue drawing.

For a guess arriving at effectively the same moment as the timeout, use the authoritative event order:

- A correct guess accepted before the timeout event wins.
- A guess received after the timeout event does not count.

---

# Scoring

Scoring is deliberately simple.

For a successful turn:

```text
First correct guesser: +1 point
Drawer: +1 point
Everyone else: +0 points
```

For an unsuccessful turn:

```text
Drawer: +0 points
All guessers: +0 points
```

There are:

- No speed bonuses.
- No decreasing points.
- No category bonuses.
- No difficulty multipliers.
- No streak bonuses.
- No penalties.
- No participation points.
- No second-place points.
- No bonus for guessing before letters appear.
- No bonus for drawing without using undo.

Scores accumulate across all three rounds.

---

# Two-Player Behaviour

The game supports two players.

However, under the chosen scoring system, every successful two-player turn awards one point to both players:

- The drawer receives one point.
- The only guesser receives one point.

This means a two-player game will always end with equal scores.

Failed turns also award neither player anything, so they do not break the tie.

This is an intentional accepted consequence of the simple scoring rules.

Do not introduce a special two-player scoring rule.

Do not remove two-player support.

At the end of a two-player game, display both players as joint winners.

---

# Result Screen

After every turn, show a short result screen for approximately three seconds.

For a successful turn, show:

- The complete answer.
- The winning guesser’s name.
- The drawer’s name.
- The points awarded.

Example:

```text
The word was:

PENGUIN

Ben guessed it first.

Ben +1
Alice +1
```

For an unsuccessful turn, show:

```text
Time is up

The word was:

PENGUIN

No points awarded
```

The result screen should advance automatically.

Do not require the host to press continue after every turn.

Do not allow players to skip the result screen manually.

After the result screen:

1. Advance to the next player in the drawing order.
2. Start the next preparation countdown.
3. Continue until every player has drawn three times.

---

# Round Transitions

After every player has drawn once, the current round ends.

Show a brief round summary before starting the next round.

The round summary may show:

- `Round 1 complete`
- Current player scores
- The next round number

Keep this screen short and automatic.

Do not add voting, ready checks, or manual continuation between rounds.

After round three, transition to the final results instead of starting another round.

---

# Final Results

At the end of the third round, show the final scoreboard.

Sort players by total score from highest to lowest.

The player with the highest score is the winner.

If several players have the same highest score, they are joint winners.

Do not use a tiebreaker.

Do not add:

- Sudden-death drawing.
- Fastest-guess comparisons.
- Total successful drawings as a tiebreaker.
- Random winner selection.
- Extra turns.
- Host-selected winners.

Example:

```text
Joint winners

Alice — 8 points
Ben — 8 points

Claire — 5 points
Daniel — 3 points
```

The final screen should provide the normal platform action for returning to the room or starting another game, but no drawing-game-specific rematch rules are needed.

---

# Disconnect Behaviour

Keep disconnect handling simple.

## A guesser disconnects during a turn

- Continue the turn.
- Remove them from the active guesser set while disconnected.
- Do not end the turn merely because one guesser disconnected.
- If they reconnect before the turn ends, allow them to resume watching and guessing.

## The drawer disconnects during a turn

- Pause or hold the turn briefly for up to five seconds.
- If the drawer reconnects during that period, continue the same turn.
- If they do not reconnect, cancel the turn.
- Award no points.
- Show that the turn was skipped.
- Continue to the next drawer.

Do not assign the same word to a replacement drawer.

## A player is disconnected when their drawing turn begins

- Skip that drawing turn.
- Award no points.
- Continue to the next player.
- Do not move the skipped turn to the end of the game.

## No guessers remain connected

If the drawer is the only connected active player:

- End the turn immediately.
- Award no points.
- Continue according to the normal turn order.

## Reconnection

A reconnected participant keeps their existing score and original place in the drawing order.

---

# Spectators

Players joining after the game starts are spectators.

Spectators may:

- Watch the live drawing.
- See the category.
- See the letter reveals.
- See result screens.
- See the scoreboard.

Spectators may not:

- Submit guesses.
- Earn points.
- Draw.
- Enter the current drawing order.
- Affect when a turn ends.

They may participate after the current game ends and a new game starts.

---

# Turn State Summary

Each turn follows these states in order:

```text
Preparing
Drawing
Result
```

## Preparing

- Three seconds.
- Drawer sees the answer.
- Guessers wait.
- No drawing.
- No guessing.
- No timer progression.
- No letter reveals.

## Drawing

- Maximum 60 seconds.
- Drawing is active.
- Guesses are active.
- Timer is active.
- Letters reveal progressively.
- Ends immediately on the first correct guess.
- Ends at timeout when nobody guesses correctly.

## Result

- Approximately three seconds.
- Shows the answer.
- Shows the winner or timeout.
- Shows points awarded.
- No drawing.
- No guessing.
- Automatically advances.

---

# Minimal Interface Requirements

## Drawer interface

Show only what the drawer needs:

- Complete answer.
- Category.
- Remaining time.
- Large drawing canvas.
- Colour palette.
- Undo button.

Do not show a guess input.

Do not show other players’ guesses.

Do not show unnecessary game instructions after the turn has started.

## Guesser interface

Show:

- Drawer name.
- Category.
- Hidden-letter pattern.
- Remaining time.
- Live drawing.
- Guess input.
- Submit action.

Do not show drawing controls.

## Result interface

Show:

- Complete answer.
- Whether someone guessed it.
- Winning guesser when applicable.
- Points awarded.
- Short countdown or automatic transition.

## Final interface

Show:

- Winner or joint winners.
- Full ranked scoreboard.
- Total scores.

---

# Required Edge Cases

The implementation must behave correctly in these cases:

1. A player correctly guesses before the first drawing stroke.
2. A player correctly guesses before any letters have appeared.
3. A player submits several wrong guesses quickly.
4. Two players submit the correct answer almost simultaneously.
5. A correct guess arrives at the same time as the timeout.
6. The drawer disconnects during the preparation countdown.
7. The drawer disconnects during drawing.
8. A guesser disconnects and reconnects during a turn.
9. A player is absent when their drawing turn begins.
10. All guessers disconnect.
11. A word contains repeated letters.
12. A word contains a space.
13. A player submits the correct answer with different capitalisation.
14. A player submits the correct answer with extra surrounding spaces.
15. A player submits a misspelling that is one letter away.
16. A player joins after the game has started.
17. Several players finish the game with the same score.
18. A two-player game finishes with both players tied.
19. The drawer presses undo several times.
20. The drawer tries to undo when no strokes remain.
21. The turn ends while the drawer’s finger is still touching the canvas.
22. A scheduled letter reveal occurs at effectively the same moment as a correct guess.

---

# Explicit Non-Goals

Do not add any of the following:

- Word choice.
- Multiple difficulty levels.
- Teams.
- Custom player-created words.
- Public guesses.
- Guess chat.
- Reactions.
- Emoji.
- Voice communication.
- Video communication.
- AI-generated words.
- AI guess validation.
- Spelling correction.
- Alias matching.
- Fuzzy matching.
- Near-miss hints.
- Extra hints beyond category and letter reveals.
- Speed-based scoring.
- Different drawing brushes.
- Eraser mode.
- Shape tools.
- Text tools.
- Image uploads.
- Drawing replay.
- Player voting.
- Reporting tools.
- Turn skipping by choice.
- Word rerolls.
- Power-ups.
- Items.
- Achievements.
- Unlockable colours.
- Cosmetic progression.
- Sudden-death tiebreakers.
- Difficulty multipliers.
- Host-controlled scoring.
- Manual approval of answers.
- Manual continuation between turns.

The purpose is to build a complete but very small game, not a feature-rich drawing platform.

---

# Acceptance Criteria

The game is complete when all of the following are true:

1. Between 2 and 8 players can start a game.
2. The game creates a random player order.
3. Every player receives exactly three drawing turns unless disconnected.
4. Each drawer receives one random word without choosing it.
5. The drawer sees the full answer.
6. Guessers see the category and exact letter structure.
7. The drawer can draw using colours.
8. Guessers see the drawing live.
9. The drawer can undo the most recent stroke.
10. Letters reveal one at a time at evenly spaced intervals.
11. Reveal positions are random.
12. All but one letter can eventually be revealed.
13. Guesses remain private.
14. Guess checking uses exact matching after minimal normalisation.
15. The first correct guess immediately ends the turn.
16. The first correct guesser receives one point.
17. The drawer receives one point.
18. Nobody else receives points.
19. A turn ends after 60 seconds when nobody guesses correctly.
20. A timed-out turn awards no points.
21. A short result screen shows the complete answer.
22. The next turn starts automatically.
23. The game ends after every player has drawn three times.
24. The highest-scoring player wins.
25. Equal highest scores produce joint winners.
26. Two-player games are allowed even though they always end tied.
27. No extra mechanics outside this specification are introduced.
