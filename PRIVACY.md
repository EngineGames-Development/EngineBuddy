# EngineBuddy privacy policy

Last updated: 2026-11-01 · Applies to EngineBuddy 0.4 and later, from GitHub or the Microsoft Store.

**Short version: EngineBuddy collects nothing. Everything stays on your PC.**

## What EngineBuddy stores, and where

On your PC only, in `%APPDATA%\enginebuddy` (Store version: the app's own data folder):

- your settings, project folders and memory notes you or the app saved;
- your chat history, including pictures you sent in a chat;
- an audit log of the actions it took or refused (kept 30 days).

You can delete chats in the chat window, notes in Settings, or everything by uninstalling and
deleting that folder. Nothing is encrypted beyond what Windows provides for your user account.

## What leaves your PC

- **Nothing goes to the developers.** There is no account, no telemetry, no analytics, no ads, no
  crash reporting.
- **The AI runs on your PC** in Ollama. EngineBuddy talks to it only on `127.0.0.1` (your own
  computer). Your messages, pictures and files are not sent to any AI service.
- **Only if "Internet" is on in Settings** (it is by default), and only when you ask something that
  needs it: EngineBuddy fetches public web pages and searches Wikipedia, like a browser would.
  Those sites see an ordinary request from your PC (your IP address and the page asked for) and
  our app name as the User-Agent. Their own privacy policies apply. Addresses in your own network
  are never contacted.
- **Downloading the AI model** (setup assistant) is done by Ollama from Ollama's model library;
  Ollama's privacy policy applies to that download.
- **Links you click** (e.g. "Download Ollama") open in your normal browser.

## Screenshots, microphone, camera

Screenshots are only taken when you click 📷 in the chat window, and you see them before sending.
EngineBuddy never uses your microphone, camera or location. Replies read aloud use Windows' own
voices on your PC.

## Children

EngineBuddy is not directed at children under 13 and collects no data from anyone.

## Changes and contact

Changes to this policy are published here, in the project's GitHub repository. Questions:
open an issue at https://github.com/EngineGames-Development/EngineBuddy/issues.
