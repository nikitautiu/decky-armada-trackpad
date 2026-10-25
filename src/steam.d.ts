// Steam's frontend globals that the plugin reads. They are undocumented internals, so they are typed `unknown`
// and narrowed where they are read (src/game.ts, src/logic/gameIcon.ts).
declare global {
  // `var` is what puts the name on `globalThis`, so it can be read without a ReferenceError when absent.
  var SteamUIStore: unknown;
  // Steam's library store; it names a game's icon (src/logic/gameIcon.ts).
  var appStore: unknown;
}

export {};
