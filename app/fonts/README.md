# IBM Plex fonts

These unmodified WOFF2 files come from the complete webfont distributions in
[IBM/plex](https://github.com/IBM/plex/tree/bf260093582f04622aacc1e9f9ca604d7ccd0c42).
They retain the Sans, Serif, and Mono families and weights used by the app.

The application loads the bundled fonts with `next/font/local`. Release builds
use the character coverage supplied by IBM and require no font downloads.

`sources.json` records the upstream URL, SHA-256, and byte length for each file.
`LICENSE.txt` is the upstream SIL Open Font License and must accompany the fonts.
