# IBM Plex fonts

These unmodified WOFF2 files come from the complete webfont distributions in
[IBM/plex](https://github.com/IBM/plex/tree/bf260093582f04622aacc1e9f9ca604d7ccd0c42).
They retain the Sans, Serif, and Mono families and weights used by the app.

The application loads them with `next/font/local` so a release build does not
need to reach Google Fonts. The complete files retain IBM's supplied character
coverage instead of downloading a Latin subset during the build.

`sources.json` records each pinned upstream URL, SHA-256, and byte length.
`LICENSE.txt` is the upstream SIL Open Font License and must accompany the fonts.
