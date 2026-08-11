# شي إلچ 🌙 — The Cairokee Surprise

An interactive, cinematic mobile-web experience that ends with the reveal of a
Cairokee concert ticket. She opens one mysterious link, walks through a short
story of doors, clues and misdirection — and only at the very end discovers
the ticket.

**⚠️ Spoiler hygiene:** the folder is intentionally named `shi-ilich`
("شي إلچ") and the page title is "شي إلچ 🌙" so that neither the URL nor the
link preview reveals anything. **Don't rename the folder to anything containing
"cairokee", "concert" or "ticket"** — she will see the URL.

---

## 1. Personalize (5 minutes)

Open **`config.js`** — every personal detail lives there and nowhere else:

| Field | What it is |
|---|---|
| `herName` / `myName` | Your names (hers appears in the greeting + on the ticket) |
| `concert.*` | Date, venue, city, optional gate/seat — Arabic + Latin versions for the ticket |
| `memoryDoor` | The memory question — replace with a real moment between you two |
| `discoveryClue` | The line she finds in the dark room |
| `heartDoor` | The "choose the vibe" question |
| `clues` | The 3 ambiguous hints (keep them ambiguous!) |
| `finalMessage` | **The most important text in the whole thing.** Write it yourself, in your own words |
| `secret` | Optional Easter egg — message + optional photo (`photo: "us.jpg"`, put the file in this folder) |
| `song` | Official Cairokee YouTube embed shown with the final letter (default: كان لك معايا). Swap `youtubeId` for any song |
| `concert.dateISO` | Exact concert datetime → drives the live countdown under the ticket |
| `ticketPhoto` | **Save your real ticket screenshot in this folder as `ticket.jpg`.** A "التذكرة الرسمية 📄" button then appears under the designed ticket and opens it full-screen. If the file is missing the button simply never appears — nothing breaks |
| `revealTrack` | Optional: a song file (that you have the right to use) that plays when the ticket appears, e.g. `"song.mp3"` |

No other file needs editing.

## 2. Test it yourself first

Open the folder with any static server and walk through the whole thing on
your phone **before** sending it:

```bash
cd shi-ilich
python3 -m http.server 8080
# then open http://<your-ip>:8080 on your phone
```

## 3. Host it

Any static host works — the site is pure HTML/CSS/JS, no backend:

- **Netlify Drop** (fastest): drag the `shi-ilich` folder onto https://app.netlify.com/drop → you get a link in seconds. Rename the site to something neutral (e.g. `layla-2026`).
- **GitHub Pages**: enable Pages on this repo → link is `https://<user>.github.io/<repo>/shi-ilich/`.
- **Vercel / Cloudflare Pages**: import the repo, done.

Then send her **just the link**, with no context. Something like:
> "افتحيه وإنتي بمكان هادي 🌙"

## 4. What she experiences (~3 minutes)

1. **A single light in darkness** — she has to tap it (no button, no explanation)
2. **Greeting** — "عندي شي إلچ… ما أگدر أنطيچ ياه بإيدي"
3. **Three doors** — memory question → a hidden drifting light she must catch → a "choose the night" question
4. **The sky changes** — stars appear, three ambiguous clues to open
5. **The guessing game** — whatever she guesses (even "حفلة"!), the site playfully deflects
6. **Fake ending** — "خلاص راح أگلچ" … "لا. بعدني ما خلصت 😌"
7. **The last question** — everything goes quiet: "توافقين تنطيني ليلة وحدة؟"
8. **Blackout → warm flash → crowd lights + stage beams ignite → "عندچ موعد. مع كايروكي 🎸"**
9. **The ticket** — a gold-foil concert pass with her name; tap it to flip to a hidden message on the back, with an optional live countdown to the show
10. **Your letter** — with a tap-to-play official Cairokee song embed (كان لك معايا), then a hidden Easter egg ending in a rain of hearts

Sound is opt-in via the 🔊 button (generated ambience only — no copyrighted
audio is embedded). The little light at the top of the screen is the hidden
progress system: it grows and warms from cold moonlight to amber stage-light
as she gets closer.
