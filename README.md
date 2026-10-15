# zepp-better-spotify-remote

[Русская версия](README-ru.md)

Spotify remote for Zepp OS watches. Made it because Music Controller from the store says "loading" for like five seconds every time, doesn't look great and ignores the hardware buttons. This one opens instantly (shows the last known state, fetches fresh data in the background), puts the track cover in the background and a clock on top.

Screens: screensaver (cover, clock; tap = pause, double tap left/right = previous/next), controls (progress ring around play, like, current playlist, device picker with volume), swipe up for the library with Liked Songs and recent playlists. The screen stays on while music plays and times out after 3 minutes on pause. Built for myself and an Amazfit Active 3 Premium; other round Zepp OS 3.6+ watches will probably work, not tested. The UI is in Russian.

## Install

You need Node.js, Spotify Premium (the API won't control playback without it) and developer mode in the Zepp app.

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard): **Web API**, Redirect URI exactly `http://127.0.0.1:8888/callback`. Grab the Client ID and Client Secret from its settings.
2. Get your tokens (a browser opens, log in to Spotify):
   ```bash
   npm i
   node tools/spotify-auth.mjs <CLIENT_ID> <CLIENT_SECRET>
   ```
   This writes `app-side/secrets.js`. It's in `.gitignore`, don't commit it.
3. Put it on the watch:
   ```bash
   npm i -g @zeppos/zeus-cli
   zeus login
   zeus preview
   ```
   Pick your watch and scan the QR code in Zepp: Profile → Developer Mode → Scan.

Wearing the watch on your right hand? Set `rightHandMode = true` in `shared/config.js` and rebuild: Up = pause, Down = next track, Select = switch screens. Icons are drawn by `tools/make_assets.py` (`python tools/make_assets.py`) if you want to tweak them.
