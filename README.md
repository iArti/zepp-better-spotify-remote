# zepp-better-spotify-remote

[Русская версия](README-ru.md)

Spotify remote for Zepp OS watches. Made it because Music Controller from the store says "loading" for like five seconds every time, doesn't look great and ignores the hardware buttons. This one opens instantly (shows the last known state, fetches fresh data in the background), puts the track cover in the background and a clock on top.

Screens: screensaver (cover, clock; tap = pause, double tap left/right = previous/next), controls (progress ring around play, like, current playlist, device picker with volume), swipe up for the library with Liked Songs and recent playlists. The screen stays on while music plays and times out after 3 minutes on pause. Covering the screen with your palm pauses the music; raising the wrist refreshes the state right away. Built for myself and an Amazfit Active 3 Premium; other round Zepp OS 3.6+ watches will probably work, not tested. The UI is in English and Russian (follows the watch language).

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

## Experimental: music from the watch

Devices → "Музыка с часов" plays the tracks you uploaded to the watch with the stock Zepp Music app, through your Bluetooth headphones, no phone needed. The current-playlist button turns into the list of those tracks; sort order is `localSort` in `shared/config.js` (`"name"`, `"artist"` or `"album"`, non-Latin titles go first).

It's experimental because it only works thanks to an oversight in the watch's file sandbox: the app reaches the system music folder through `data://../../../Downloads/Music/list`. A firmware update can close that any day. Tags are read straight from the files on the watch.

Covers are optional and a bit of a hassle: the watch can't decode the JPEGs inside MP3s, so they're prepared on the PC and baked into the app. Point the script at the same folder you upload from, then rebuild:

```bash
python tools/import_covers.py "path/to/your/music"
```

It needs ffmpeg on PATH and writes `assets/common.r/covers/` (gitignored). Each cover adds ~30 KB to the install.

`applyOptimizations` in `shared/config.js` polls Spotify less often on the screensaver (15 s while playing, 30 s on pause) to save battery. Off by default, because pauses and skips made on other devices then show up late.

## Optional: SimpleZepp for phone volume

Spotify won't let anyone change the volume of a phone through its API. If [SimpleZepp](https://github.com/iArti/SimpleZepp) is installed on the same phone, the devices screen shows a "Подключить SimpleZepp" row; tap it, allow the request in the notification on the phone, and the volume controls work for Spotify on the phone too. Without SimpleZepp nothing changes.
