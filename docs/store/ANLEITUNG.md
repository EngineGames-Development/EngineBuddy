# EngineBuddy in den Microsoft Store bringen, und dafür sorgen, dass Leute ihn finden

Diese Schritte kannst nur du machen: Sie laufen über dein Microsoft-Konto und deine Identität.
Alles, was ins Projekt gehört (Paket, Texte, Datenschutzerklärung), ist schon vorbereitet.

## Teil 1: In den Store

### 1. Entwicklerkonto anlegen (einmalig)

1. Auf <https://storedeveloper.microsoft.com> mit deinem Microsoft-Konto anmelden und
   **Einzelperson** wählen. Für Einzelpersonen ist die Anmeldung derzeit kostenlos; prüf die
   aktuellen Bedingungen auf der Seite.
2. Identität bestätigen (Ausweis und Selfie, macht Microsoft selbst). Das kann ein paar Tage dauern.
3. Der **Anzeigename** des Herausgebers wird im Store angezeigt, z. B. „EngineGames-Development“.

### 2. Namen reservieren

Partner Center → **Apps und Spiele** → **Neues Produkt** → **MSIX- oder PWA-App** → Name
„EngineBuddy“ reservieren. Ist er schon vergeben, nimm z. B. „EngineBuddy Desktop“.

### 3. Identität ins Projekt eintragen

Partner Center → dein Produkt → **Produktverwaltung** → **Produktidentität**. Dort stehen drei
Werte. Trag sie in `electron-builder.yml` unter `appx:` ein (oder gib sie mir):

| Partner Center | electron-builder.yml |
|---|---|
| Package/Identity/Name | `identityName` |
| Package/Identity/Publisher (beginnt mit `CN=`) | `publisher` |
| Package/Properties/PublisherDisplayName | `publisherDisplayName` |

Danach committen und pushen.

### 4. Paket bauen lassen

GitHub → **Actions** → **Store package** → **Run workflow**. Nach ein paar Minuten liegt unter dem
Lauf das Artefakt **store-package** mit `EngineBuddy-<version>.appx`. Herunterladen und entpacken.

### 5. Einreichung ausfüllen

Partner Center → **Einreichung starten**:

- **Preise und Verfügbarkeit:** Kostenlos, alle Märkte.
- **Eigenschaften:** Kategorie *Entwicklertools*; Datenschutz-URL und Support aus
  [listing.md](listing.md).
- **Altersfreigaben:** Fragebogen ausfüllen, die Antworten stehen in [listing.md](listing.md).
- **Pakete:** die `.appx` hochladen.
- **Store-Einträge:** Deutsch und Englisch aus [listing.md](listing.md) kopieren, Screenshots
  hochladen (Liste dort).
- **Hinweise für die Zertifizierung:** den Text aus [listing.md](listing.md) übernehmen. Wichtig,
  weil die KI in Ollama läuft, einer separaten App.

Dann **An den Store übermitteln**. Die Prüfung dauert meist 1–3 Tage. Lehnt Microsoft etwas ab,
steht im Bericht genau, was; schick ihn mir, dann passe ich es an.

### 6. Updates

Neue Version: Versionsnummer erhöhen, taggen (wie bisher), den Store-Workflow laufen lassen, im
Partner Center eine neue Einreichung mit dem neuen Paket starten. Store-Nutzer bekommen das Update
automatisch.

## Teil 2: Damit Leute EngineBuddy finden

Der Store allein bringt kaum Besucher. Was wirklich hilft, grob nach Aufwand sortiert:

1. **GitHub aufhübschen** (10 Minuten): Im Repo oben rechts bei *About* eine Beschreibung,
   die Website (später der Store-Link) und **Topics** setzen: `desktop-companion`, `ai-assistant`,
   `ollama`, `local-ai`, `electron`, `windows`, `desktop-pet`, `privacy`. Topics sind der
   wichtigste Weg, wie Leute auf GitHub suchen.
2. **Ein kurzes Video oder GIF** (30 Sekunden): Figur auf dem Desktop, Frage stellen, Antwort,
   Befehl mit Bestätigungsfenster. Oben ins README und in jeden Post. Das wirkt mehr als jeder Text.
3. **Store-Badge ins README**, sobald die App im Store ist (Microsoft bietet offizielle Badges
   unter <https://apps.microsoft.com/badge>).
4. **Communitys, in denen lokale KI ein Thema ist** (ehrlich vorstellen, nicht spammen; die Regeln
   der jeweiligen Community lesen):
   - Reddit: r/LocalLLaMA, r/ollama, r/selfhosted, r/Windows11, r/SideProject
   - Hacker News: „Show HN: EngineBuddy – a free desktop AI companion that runs locally“
   - Ollama-Discord (Bereich für Projekte), deutschsprachig z. B. r/de_EDV
5. **In Listen eintragen lassen:** Pull Request bei „awesome-ollama“- bzw.
   „awesome-local-ai“-Listen auf GitHub, und bei der Projekte-Liste im Ollama-README
   („Community Integrations“).
6. **winget-Paket** (später): Mit einer Eintragung in `microsoft/winget-pkgs` können Leute
   `winget install EngineBuddy` tippen. Das geht am besten, sobald die Releases signiert sind.
7. **Product Hunt** (wenn Video und Store-Link stehen): an einem Dienstag bis Donnerstag starten.

Was den Leuten ins Auge fällt: **kostenlos, ohne Konto, läuft lokal, Open Source**. Das in den
ersten Satz jedes Posts.

## Teil 3: Signatur für die GitHub-Downloads

Die Store-Version signiert Microsoft. Damit auch die `.exe` von GitHub ohne SmartScreen-Warnung
startet: bei der **SignPath Foundation** (<https://signpath.org>) kostenlose Code-Signatur für
Open-Source-Projekte beantragen. Wenn du die Zugangsdaten hast, baue ich die Signatur in den
Release-Workflow ein.
