# Get Notes Sync Skill (Get 笔记自动同步)

A powerful skill to automatically sync, transcribe, and utilize your voice notes from [Get Notes (biji.com)](https://www.biji.com).

> Turn your fleeting voice memos into permanent personal knowledge assets.

## 🚀 Key Features

*   **Automated Sync**: One-click sync of all your voice notes to your local machine.
*   **Smart Classification**: Automatically organizes notes intofolders:
    *   `Meeting` (会议)
    *   `Client` (客户)
    *   `Inspiration` (灵感)
    *   `Todo` (待办)
*   **Full Transcription**: Archives not just the AI summary, but the **full original transcription** (sentence-by-sentence) into Markdown.
*   **Web Dashboard**: A beautiful Notion-style local dashboard to view sync status and manage login.
*   **History Support**: Supports fetching your entire history (all historical notes) using intelligent cursor-based pagination.
*   **Deduplication**: Built-in tool to clean up duplicate files.

## 📦 Installation

This skill is designed to be used as an AI Agent Skill or a standalone Node.js tool.

### Prerequisites

*   Node.js (v18 or higher)
*   A Get Notes (biji.com) account

### Setup

1.  Clone this repository or download the skill folder.
2.  Install dependencies:

```bash
npm install
npx playwright install chromium
```

## 🛠️ Usage

### 1. Start Support Dashboard (Recommended)

The dashboard allows you to monitor sync status and log in easily.

```bash
node scripts/dashboard.js
```

Open `http://localhost:3456` in your browser.

### 2. Run Sync Manually

```bash
node scripts/sync.js
```

*   **First Run**: A browser window will open. Scan the QR code or log in with your phone number on `biji.com`.
*   **Subsequent Runs**: The script uses the cached token to sync automatically in the background.

### 3. Clean Duplicates

If you have duplicate files (e.g., from multiple sync attempts), run:

```bash
node scripts/dedupe.js
```

## ⚙️ Configuration

You can configure the output directory via environment variables:

```bash
# Sync to a specific folder
OUTPUT_DIR=/Users/me/Obsidian/Inbox/GetNotes node scripts/sync.js
```

By default, notes are saved to a `./notes` folder inside the `scripts` directory (or user defined path).

## 🤖 How it Works

1.  **Authentication**: Uses Playwright to handle the complex login flow and caches the JWT token securely.
2.  **Pagination**: Uses `since_id` cursor pagination to robustly fetch all historical data.
3.  **Processing**:
    *   Fetches note detail.
    *   Fetches original audio transcript.
    *   Analyzes content/duration to determine category.
    *   Generates a formatted Markdown file with metadata (YAML frontmatter).

## 📝 License

MIT
