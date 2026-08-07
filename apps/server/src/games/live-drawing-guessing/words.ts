/**
 * Curated word pool for exact-answer matching.
 *
 * Every word has one canonical spelling and no common alias: each entry is
 * common, easy to draw, 4-12 alphabetical letters long (excluding spaces),
 * and appropriate for general audiences. Two-word answers are kept sparse.
 * Plurals, regional vocabulary, brand names, and ambiguous objects are
 * deliberately absent.
 */
export const WORD_CATEGORIES = [
  "Animal",
  "Food",
  "Object",
  "Place",
  "Nature",
  "Person",
  "Action",
  "Transport",
] as const;

export type WordCategory = (typeof WORD_CATEGORIES)[number];

export interface WordEntry {
  readonly word: string;
  readonly category: WordCategory;
}

export const WORD_POOL: readonly WordEntry[] = [
  { word: "bird", category: "Animal" },
  { word: "fish", category: "Animal" },
  { word: "horse", category: "Animal" },
  { word: "rabbit", category: "Animal" },
  { word: "frog", category: "Animal" },
  { word: "duck", category: "Animal" },
  { word: "lion", category: "Animal" },
  { word: "tiger", category: "Animal" },
  { word: "bear", category: "Animal" },
  { word: "monkey", category: "Animal" },
  { word: "elephant", category: "Animal" },
  { word: "giraffe", category: "Animal" },
  { word: "zebra", category: "Animal" },
  { word: "snake", category: "Animal" },
  { word: "spider", category: "Animal" },
  { word: "penguin", category: "Animal" },
  { word: "turtle", category: "Animal" },
  { word: "kangaroo", category: "Animal" },
  { word: "whale", category: "Animal" },
  { word: "crab", category: "Animal" },
  { word: "shark", category: "Animal" },
  { word: "dolphin", category: "Animal" },
  { word: "apple", category: "Food" },
  { word: "banana", category: "Food" },
  { word: "orange", category: "Food" },
  { word: "lemon", category: "Food" },
  { word: "grape", category: "Food" },
  { word: "cherry", category: "Food" },
  { word: "carrot", category: "Food" },
  { word: "potato", category: "Food" },
  { word: "tomato", category: "Food" },
  { word: "onion", category: "Food" },
  { word: "bread", category: "Food" },
  { word: "cheese", category: "Food" },
  { word: "pizza", category: "Food" },
  { word: "cake", category: "Food" },
  { word: "hamburger", category: "Food" },
  { word: "soup", category: "Food" },
  { word: "milk", category: "Food" },
  { word: "pasta", category: "Food" },
  { word: "rice", category: "Food" },
  { word: "salad", category: "Food" },
  { word: "muffin", category: "Food" },
  { word: "pancake", category: "Food" },
  { word: "corn", category: "Food" },
  { word: "peach", category: "Food" },
  { word: "pear", category: "Food" },
  { word: "melon", category: "Food" },
  { word: "strawberry", category: "Food" },
  { word: "ice cream", category: "Food" },
  { word: "book", category: "Object" },
  { word: "chair", category: "Object" },
  { word: "table", category: "Object" },
  { word: "lamp", category: "Object" },
  { word: "clock", category: "Object" },
  { word: "lock", category: "Object" },
  { word: "door", category: "Object" },
  { word: "window", category: "Object" },
  { word: "mirror", category: "Object" },
  { word: "spoon", category: "Object" },
  { word: "fork", category: "Object" },
  { word: "knife", category: "Object" },
  { word: "plate", category: "Object" },
  { word: "bowl", category: "Object" },
  { word: "bottle", category: "Object" },
  { word: "umbrella", category: "Object" },
  { word: "backpack", category: "Object" },
  { word: "suitcase", category: "Object" },
  { word: "wallet", category: "Object" },
  { word: "camera", category: "Object" },
  { word: "computer", category: "Object" },
  { word: "ladder", category: "Object" },
  { word: "hammer", category: "Object" },
  { word: "rope", category: "Object" },
  { word: "ball", category: "Object" },
  { word: "kite", category: "Object" },
  { word: "drum", category: "Object" },
  { word: "guitar", category: "Object" },
  { word: "piano", category: "Object" },
  { word: "violin", category: "Object" },
  { word: "balloon", category: "Object" },
  { word: "pillow", category: "Object" },
  { word: "blanket", category: "Object" },
  { word: "towel", category: "Object" },
  { word: "soap", category: "Object" },
  { word: "toothbrush", category: "Object" },
  { word: "comb", category: "Object" },
  { word: "pencil", category: "Object" },
  { word: "house", category: "Place" },
  { word: "school", category: "Place" },
  { word: "hospital", category: "Place" },
  { word: "castle", category: "Place" },
  { word: "church", category: "Place" },
  { word: "bridge", category: "Place" },
  { word: "farm", category: "Place" },
  { word: "park", category: "Place" },
  { word: "beach", category: "Place" },
  { word: "desert", category: "Place" },
  { word: "island", category: "Place" },
  { word: "village", category: "Place" },
  { word: "city", category: "Place" },
  { word: "airport", category: "Place" },
  { word: "stadium", category: "Place" },
  { word: "museum", category: "Place" },
  { word: "library", category: "Place" },
  { word: "shop", category: "Place" },
  { word: "market", category: "Place" },
  { word: "hotel", category: "Place" },
  { word: "swimming pool", category: "Place" },
  { word: "moon", category: "Nature" },
  { word: "star", category: "Nature" },
  { word: "cloud", category: "Nature" },
  { word: "rain", category: "Nature" },
  { word: "snow", category: "Nature" },
  { word: "fire", category: "Nature" },
  { word: "water", category: "Nature" },
  { word: "river", category: "Nature" },
  { word: "lake", category: "Nature" },
  { word: "ocean", category: "Nature" },
  { word: "mountain", category: "Nature" },
  { word: "hill", category: "Nature" },
  { word: "tree", category: "Nature" },
  { word: "flower", category: "Nature" },
  { word: "grass", category: "Nature" },
  { word: "leaf", category: "Nature" },
  { word: "rock", category: "Nature" },
  { word: "sand", category: "Nature" },
  { word: "volcano", category: "Nature" },
  { word: "rainbow", category: "Nature" },
  { word: "lightning", category: "Nature" },
  { word: "tornado", category: "Nature" },
  { word: "snowman", category: "Nature" },
  { word: "waterfall", category: "Nature" },
  { word: "cave", category: "Nature" },
  { word: "forest", category: "Nature" },
  { word: "doctor", category: "Person" },
  { word: "nurse", category: "Person" },
  { word: "teacher", category: "Person" },
  { word: "farmer", category: "Person" },
  { word: "guard", category: "Person" },
  { word: "firefighter", category: "Person" },
  { word: "chef", category: "Person" },
  { word: "pilot", category: "Person" },
  { word: "astronaut", category: "Person" },
  { word: "king", category: "Person" },
  { word: "queen", category: "Person" },
  { word: "prince", category: "Person" },
  { word: "princess", category: "Person" },
  { word: "pirate", category: "Person" },
  { word: "clown", category: "Person" },
  { word: "baby", category: "Person" },
  { word: "soldier", category: "Person" },
  { word: "singer", category: "Person" },
  { word: "dancer", category: "Person" },
  { word: "swim", category: "Action" },
  { word: "dance", category: "Action" },
  { word: "sing", category: "Action" },
  { word: "read", category: "Action" },
  { word: "write", category: "Action" },
  { word: "cook", category: "Action" },
  { word: "sleep", category: "Action" },
  { word: "draw", category: "Action" },
  { word: "paint", category: "Action" },
  { word: "climb", category: "Action" },
  { word: "kick", category: "Action" },
  { word: "throw", category: "Action" },
  { word: "boat", category: "Transport" },
  { word: "ship", category: "Transport" },
  { word: "truck", category: "Transport" },
  { word: "bicycle", category: "Transport" },
  { word: "motorcycle", category: "Transport" },
  { word: "helicopter", category: "Transport" },
  { word: "rocket", category: "Transport" },
  { word: "submarine", category: "Transport" },
  { word: "tractor", category: "Transport" },
  { word: "scooter", category: "Transport" },
  { word: "canoe", category: "Transport" },
  { word: "taxi", category: "Transport" },
  { word: "train", category: "Transport" },
] as const;

/**
 * Count only alphabetical letters: spaces, hyphens, apostrophes, and other
 * punctuation never count toward the pattern length or reveal interval.
 */
export function letterCount(word: string): number {
  let count = 0;
  for (const char of word) {
    if (/[A-Za-z]/.test(char)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Build the letter pattern. Every alphabetical letter starts as "_"; spaces
 * and punctuation are shown immediately. Revealed positions replace their
 * underscore with the actual letter, independently for each position.
 */
export function buildLetterPattern(word: string, revealed: readonly number[] = []): string[] {
  const revealedSet = new Set(revealed);
  const pattern: string[] = [];
  let letterIndex = 0;
  for (const char of word) {
    if (/[A-Za-z]/.test(char)) {
      pattern.push(revealedSet.has(letterIndex) ? char.toUpperCase() : "_");
      letterIndex += 1;
    } else {
      pattern.push(char);
    }
  }
  return pattern;
}
