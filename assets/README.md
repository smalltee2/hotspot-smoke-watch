# SEA-HAF logo (concept D, Smoke-Fire S)

Southeast Asia Hybrid Air Quality Forecast. Text is converted to outlines (Sora Bold + IBM Plex Mono Medium), so no fonts are needed.

| File | Use |
|---|---|
| sea-haf-logo-light.svg / .png | Full logo on light backgrounds |
| sea-haf-logo-dark.svg / .png | Full logo on dark backgrounds |
| sea-haf-mark-light.svg / -dark.svg | Icon only |
| sea-haf-wordmark-light.svg / -dark.svg | "SEA-HAF" text only |
| favicon.svg | Browser icon, switches colors automatically in dark mode |
| favicon.ico, favicon-32.png | Fallback for older browsers |
| apple-touch-icon.png (180), icon-192.png, icon-512.png | Phone home screen / PWA |

Colors: Ember #E5560F, Smoke #33414F (dark mode: #FF7A33, #C9D3DC).

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

## In this repository

Only `favicon.svg` and `sea-haf-logo-light.svg` were supplied; `sea-haf-logo-dark.svg` is made from the light file with the dark-mode colours above (#33414F → #C9D3DC, #E5560F → #FF7A33). The pages use `favicon.svg` as the browser icon, an inline copy of the mark in the header (`.brand .mark`, same paths and colours) and the full logo at the top of the About tab. The workflow publishes this folder as `/assets/`. The PNG / ICO files listed above are not here yet.

## Chatbot icon (concept B, AQI Ring)

`sea-haf-bot-light.svg` (supplied) and `sea-haf-bot-dark.svg` (made from it with the dark-mode colours above: #33414F → #C9D3DC, #E5560F → #FF7A33, the white half of the S → #111820): the "S" of the logo in a circle, ringed clockwise from the top by good (green #3BB273), moderate (yellow #F2C230), unhealthy for sensitive groups (orange) and unhealthy (red #D64545). Used for the "Ask SEA-HAF" launcher (about 36 px in a 56 px button) and as the bot's avatar in the chat; light or dark file with the theme.

`sea-haf-bot-animated-light.svg` (supplied) and `sea-haf-bot-animated-dark.svg` (same colour change): the same icon with the ring swinging and a "typing" speech bubble (SVG animation, 4 s loop; viewBox 0 −14 78 78, the ring on the left, the bubble at the top right). Used for the chat launcher; viewers who ask their system for reduced motion get the still icon.
