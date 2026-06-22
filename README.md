<p align="center">
  <img src="build-resources/icon.png" alt="netrun logo" width="160">
</p>

# NETRUN

privacy-focused AI-native smart browser that i worked on all day for 38 straight days.

## Gallery

<table>
  <tr>
    <td width="33%"><img src="screenshots/01-reader.png" alt="reader"></td>
    <td width="33%"><img src="screenshots/02-chat.png" alt="chat"></td>
    <td width="33%"><img src="screenshots/03-lookup.png" alt="lookup"></td>
  </tr>
  <tr>
    <td align="center"><em>left: netrun, right: chrome. notice how much space you save, while still having all the essentials</em></td>
    <td align="center"><em>home page is way cleaner than chrome and is built around the search bar</em></td>
    <td align="center"><em>i love this feature: right clicking brings up an interactive ai panel that follows your mouse. no side panels.</em></td>
  </tr>
  <tr>
    <td width="33%"><img src="screenshots/05-paper-panel.png" alt="paper panel"></td>
    <td width="33%"><img src="screenshots/04-pdf-reader.png" alt="pdf reader"></td>
    <td width="33%"><img src="screenshots/06-chats.png" alt="chats"></td>
  </tr>
  <tr>
    <td align="center"><em>custom PDF reader that automatically brings up references and metadata about your research papers</em></td>
    <td align="center"><em>dark mode papers</em></td>
    <td align="center"><em>all chats routed to one place</em></td>
  </tr>
</table>

## Features

- right-click to get ai panel anywhere
- cleaner than apple
- brain-rot warnings
- convincing ai voice that read pages aloud and highlights the words being spoken
- max privacy (HTTPS-only, tracker/cookie blocking, DoH, WebRTC leak guard)
- youtube ad blocking (uses brave's blocker so it works great)
- browser agents (local Ollama or cloud OpenRouter)
- buttery custom paper reader and researcher mode
- personalized recommendation engine
- analyzes page and warns you about scams or over-exaggerations

## Install & Run

```bash
./setup.sh      # install dependencies (macOS, one time)
npm start       # launch the app
```