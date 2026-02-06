---
name: Get Notes Auto Sync
description: A skill to automatically sync, transcribe, and organize notes from Get Notes (biji.com) to a local Markdown knowledge base.
---

# Get Notes Auto Sync

This skill allows you to automatically sync voice notes from the Get Notes (biji.com) platform to your local machine. It handles authentication, continuous syncing, and organization of notes into categories.

## Features

- **Automated Sync**: Fetches notes from Get Notes API with cursor-based pagination.
- **Full Transcription**: Retrieves both the AI summary and the full original transcript.
- **Smart Classification**: Automatically categorizes notes into Meetings, Clients, Inspiration, or Todos based on content and duration.
- **Deduplication**: Ensures no duplicate notes are saved using `note_id`.
- **Dashboard**: Provides a local web dashboard to monitor sync status and manage login.

## Usage

### Prerequisites
- Node.js (v18+)
- Playwright (`npx playwright install chromium`)

### 1. Setup
Run `npm install` in the skill directory to install dependencies.

### 2. Configure
The scripts use default relative paths. You can modify `config.js` (if extracted) or pass environment variables.
By default, notes are saved to a `./notes` directory.

### 3. Run Sync
```bash
node scripts/sync.js
```
On first run, a browser window will open for you to log in to `biji.com`.

### 4. Run Dashboard
```bash
node scripts/dashboard.js
```
Opens a web interface at `http://localhost:3456`.

## Scripts

- `scripts/sync.js`: Main synchronization logic.
- `scripts/dashboard.js`: Web-based control panel.
- `scripts/dedupe.js`: Utility to clean up duplicate files.

## Automation

To run this daily, you can use the provided `com.sky.getnotes.sync.plist` template for macOS `launchd`.
