// App settings. Change and rebuild.

// Watch worn on the right hand: the Select button is hard to reach.
//   false: Select = play/pause, Select hold = next track
//   true:  Up = play/pause, Down = next track, Down hold = previous track,
//          Select = switch between screensaver and controls
export const rightHandMode = false;

// "Music from the watch" sort order: "name", "artist" or "album".
// Non-Latin titles (e.g. Cyrillic) always come before Latin ones.
export const localSort = "name";

// Battery saving for long screensaver use (Spotify only).
//   false: Spotify is polled every 3 s on every screen.
//   true:  on the screensaver Spotify is polled every 15 s while playing (plus right
//          after the expected end of the track) and every 30 s while paused.
//          Changes made on other devices (pause, skip) then show up with a delay.
// Diff rendering and skipping the hidden progress ring are always on: no trade-off.
export const applyOptimizations = false;
