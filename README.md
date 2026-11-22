# hxrry.dev

my personal homepage: a static site i'm currently hosting on cloudflare pages, plus a few tiny functions for what i'm listening to (Spotify), playing (Steam) and the weather (Open-Meteo). deliberately lightweight

## content

projects and work history are markdown files; the build turns them into the homepage sections and their own pages

homepage shows the 2 most recent work roles; `/experience/` shows everything, grouped by employer

using the spotify and steam API's as well as manually amending the books and language. 

## privacy

- no analytics, trackers or third-party requests from visitors' browsers
- runs entirely on Cloudflare; nothing points at a server or network of mine
- personal data is either chosen to be public or redacted/hidden in the form of secrets, including location for weather and age etc.

## licences

the code is MIT. that doesn't cover my written content, or the fonts and icons, which keep their own licences:

- [Jost](https://github.com/indestructible-type/Jost) and [Caveat](https://github.com/googlefonts/caveat): SIL Open Font License (`public/fonts/`).
- [Lucide](https://lucide.dev) icons: ISC (`public/icons/LICENSE-lucide.txt`).
- brand logos from [Simple Icons](https://simpleicons.org) (v16.38.0; Twitter and LinkedIn from v10.4.0): CC0 (`public/icons/LICENSE-simple-icons.md`). trademarks of their owners, shown in their own colours.
- VS Code icon: Microsoft's official file, unmodified (`public/icons/NOTICE-vscode.txt`).
- weather data: [Open-Meteo](https://open-meteo.com), CC BY 4.0, credited in the footer.
