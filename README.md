# Vocabulary Quiz App

This is a simple vocabulary quiz web app built with plain HTML, CSS, and JavaScript.

## Files

- `index.html` — app structure
- `styles.css` — layout and styling
- `script.js` — question logic and interaction
- `mockup.html` — early visual mockup

## How to use

Serve the app over HTTP so the browser can load `questions.json`.

Example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## What it does

- shows a random vocabulary question
- lets the user click an answer
- reveals inline feedback for all options
- displays explanation, related words, and example sentences
- tracks question progress at the top
