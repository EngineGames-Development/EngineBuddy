# 018: Setup assistant and Microsoft Store package

## What was built

- **Setup assistant** (`src/main/setup-assistant.ts`, `src/integrations/ollama/ollama-setup.ts`,
  Settings → Get started): on start, if Ollama isn't running or the configured model is missing,
  the settings window opens with two steps: "Download Ollama" (opens ollama.com in the browser)
  and "Download <model>" (Ollama's `/api/pull`, with a progress bar and Stop). The model is
  recommended by RAM (`qwen3:8b` from 16 GB, else `qwen3:4b`; `qwen3:14b` as an option). When it's
  done, Settings is switched to it and a restart is offered.
- **Store package:** `appx` section in `electron-builder.yml` (identity placeholders until Partner
  Center provides them), `npm run dist:store`, and `.github/workflows/store.yml` (on tags and by
  hand) uploading the `.appx` as a workflow artifact.
- **Store paperwork:** PRIVACY.md, `docs/store/listing.md` (German and English texts, features,
  keywords, age-rating answers, certification notes), `docs/store/ANLEITUNG.md` (the owner's steps
  for Partner Center, discoverability, and code signing).

## Why this way

- EngineBuddy doesn't download or run installers itself: that would make it a downloader of
  executable code (a Store policy problem and a security one). Ollama's own download page and
  Ollama's own model pull keep each part with its maker and license.
- The assistant reuses the settings window and its sender check instead of a new window and IPC
  channel: less surface, same guarantees.
- The Store build runs on GitHub: locally the bundled `makeappx.exe` fails to start ("side-by-side
  configuration is incorrect", a missing Visual C++ runtime on this PC).

## Verified

- `npm run check`: 298 tests pass (new: Ollama status, recommendation, pull progress and errors,
  setup commands accept only the offered models).
- Live, built app, the user's Ollama with `qwen3:8b` (Ryzen 3 3200G, 14 GB RAM): "Wie geht es
  meinem PC?" called get_system_info and answered in German; "Was ist der Ryzen 3 3200G?" called
  search_wikipedia and cited the article (the summary had factual slips: the limits of an 8 B
  model); read_web_page to 192.168.178.1 was refused (audit: deny), and the model explained it
  without retrying. Answers took 1–3 minutes on this PC with RAM nearly full, which is why the
  assistant recommends `qwen3:4b` below 16 GB.
- With the configured model already installed, Settings shows no setup section (as intended).
- Not verified yet: the Store workflow on GitHub (run it by hand once), the assistant's download
  flow end to end in the UI (covered by unit tests with a fake Ollama).
