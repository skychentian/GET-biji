#!/usr/bin/env node

/**
 * Get Notes Auto Sync
 * 
 * A tool to sync notes from biji.com with auto-login and history support.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Configuration
// You can override OUTPUT_DIR via environment variable: OUTPUT_DIR=./my-notes node sync.js
const CONFIG = {
    baseUrl: 'https://get-notes.luojilab.com',
    loginUrl: 'https://www.biji.com/note',
    listEndpoint: '/voicenotes/web/notes',
    detailEndpoint: '/voicenotes/web/notes/',
    originalEndpoint: '/voicenotes/web/notes/',

    // Default to ./notes in the current directory if not specified
    outputDir: process.env.OUTPUT_DIR || path.join(process.cwd(), 'notes'),

    // State files stored in the same directory as the script or custom path
    syncStateFile: path.join(__dirname, '../.sync-state.json'),
    authStateFile: path.join(__dirname, '../.auth-state.json'),
    tokenCacheFile: path.join(__dirname, '../.token-cache.json'),

    pageSize: 20,
    delayMs: 500,
    fetchOriginal: true
};

let token = null;

async function getToken() {
    if (token) return token;

    if (fs.existsSync(CONFIG.tokenCacheFile)) {
        try {
            const cache = JSON.parse(fs.readFileSync(CONFIG.tokenCacheFile, 'utf8'));
            if (cache.tokenExpireAt && Date.now() / 1000 < cache.tokenExpireAt - 300) {
                token = cache.token;
                // console.log('  ✅ Using cached token');
                return token;
            }
        } catch (e) { }
    }

    console.log('🔐 Token expired or missing. Launching browser for login...');

    const browser = await chromium.launch({ headless: false });
    const context = fs.existsSync(CONFIG.authStateFile)
        ? await browser.newContext({ storageState: CONFIG.authStateFile })
        : await browser.newContext();

    const page = await context.newPage();
    await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle' });

    let isLoggedIn = await page.evaluate(() => !!localStorage.getItem('token'));

    if (!isLoggedIn) {
        console.log('\n  ⏳ Please log in via the browser window...\n');
        while (!isLoggedIn) {
            await new Promise(r => setTimeout(r, 2000));
            isLoggedIn = await page.evaluate(() => !!localStorage.getItem('token'));
        }
        console.log('  ✅ Login successful!');
    }

    const authInfo = await page.evaluate(() => ({
        token: localStorage.getItem('token'),
        tokenExpireAt: localStorage.getItem('token_expire_at')
    }));

    token = authInfo.token;

    await context.storageState({ path: CONFIG.authStateFile });
    fs.writeFileSync(CONFIG.tokenCacheFile, JSON.stringify({
        token: authInfo.token,
        tokenExpireAt: authInfo.tokenExpireAt ? parseInt(authInfo.tokenExpireAt) : null,
        savedAt: new Date().toISOString()
    }, null, 2), 'utf8');

    await browser.close();
    return token;
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function classifyNote(note) {
    const noteType = note.note_type || '';
    const entryType = note.entry_type || '';
    const content = ((note.content || '') + ' ' + (note.title || '')).toLowerCase();

    let durationMinutes = 0;
    if (note.attachments && note.attachments.length > 0) {
        const audioDuration = note.attachments.find(a => a.duration)?.duration || 0;
        durationMinutes = Math.round(audioDuration / 60000);
    }

    if (noteType === 'recorder_audio' || entryType === 'ai') {
        if (durationMinutes > 10) {
            if (content.includes('客户') || content.includes('交流') || content.includes('需求')) return '客户';
            return '会议';
        }
        if (durationMinutes < 3) {
            if (content.includes('待办') || content.includes('记得')) return '待办';
            return '灵感';
        }
    }

    if (content.includes('会议') || content.includes('讨论') || content.includes('培训')) return '会议';
    if (content.includes('客户') || content.includes('报价') || content.includes('合作')) return '客户';
    if (content.includes('复盘') || content.includes('反思')) return '复盘';
    if (content.includes('选题') || content.includes('文章') || content.includes('课程')) return '选题';
    if (content.includes('待办') || content.includes('要做')) return '待办';

    return '灵感';
}

function formatOriginalTranscript(originalData) {
    if (!originalData || !originalData.content) return null;

    try {
        const contentObj = JSON.parse(originalData.content);
        const sentences = contentObj.sentence_list || [];
        if (sentences.length === 0) return null;

        let result = '';
        let currentSpeaker = null;
        let currentParagraph = [];

        sentences.forEach((sentence, index) => {
            const speakerId = sentence.speaker_id;
            const text = sentence.text || '';
            const startTime = sentence.start_time || 0;
            const prevEndTime = index > 0 ? (sentences[index - 1].end_time || 0) : 0;

            if (speakerId !== currentSpeaker || startTime - prevEndTime > 5000) {
                if (currentParagraph.length > 0) {
                    const ts = formatDuration(sentences[index - currentParagraph.length]?.start_time || 0);
                    const label = currentSpeaker !== null ? `**[Speaker ${currentSpeaker + 1}]**` : '';
                    result += `\n[${ts}] ${label} ${currentParagraph.join('')}\n`;
                }
                currentSpeaker = speakerId;
                currentParagraph = [text];
            } else {
                currentParagraph.push(text);
            }
        });

        if (currentParagraph.length > 0) {
            const idx = sentences.length - currentParagraph.length;
            const ts = formatDuration(sentences[idx]?.start_time || 0);
            const label = currentSpeaker !== null ? `**[Speaker ${currentSpeaker + 1}]**` : '';
            result += `\n[${ts}] ${label} ${currentParagraph.join('')}\n`;
        }

        return result.trim();
    } catch (e) {
        return null;
    }
}

function generateMarkdown(note, originalTranscript) {
    const category = classifyNote(note);
    const createdDate = note.created_at || '';

    let durationMinutes = 0;
    if (note.attachments && note.attachments.length > 0) {
        const audioDuration = note.attachments.find(a => a.duration)?.duration || 0;
        durationMinutes = Math.round(audioDuration / 60000);
    }

    let md = `---\n`;
    md += `title: "${(note.title || 'Untitled').replace(/"/g, '\\"')}"\n`;
    md += `created_at: ${createdDate}\n`;
    md += `note_id: ${note.note_id}\n`;
    md += `category: ${category}\n`;
    if (durationMinutes > 0) md += `duration_minutes: ${durationMinutes}\n`;
    md += `---\n\n`;

    if (note.content) md += `${note.content}\n\n`;

    if (note.attachments && note.attachments.length > 0) {
        md += `## 📎 Attachments\n\n`;
        note.attachments.forEach(att => {
            const url = att.url || att.attach_url || att.link;
            const duration = att.duration ? ` (${Math.round(att.duration / 60000)} min)` : '';
            if (url) md += `- [audio${duration}](${url})\n`;
        });
        md += `\n`;
    }

    if (originalTranscript) {
        md += `## 📝 Transcript\n\n${originalTranscript}\n\n`;
    }

    md += `---\n> Synced at: ${new Date().toLocaleString()}\n`;
    return md;
}

function saveNote(note, originalTranscript) {
    const fileDate = (note.created_at || '').split(' ')[0] || 'unknown-date';
    const category = classifyNote(note);
    const safeTitle = (note.title || 'Untitled').replace(/[\/\\:*?"<>|]/g, '_').substring(0, 40);
    const filename = `${fileDate}_${category}_${safeTitle}.md`;
    const filepath = path.join(CONFIG.outputDir, filename);

    fs.writeFileSync(filepath, generateMarkdown(note, originalTranscript), 'utf8');
    return filename;
}

async function fetchWithAuth(url) {
    const t = await getToken();
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${t}`, 'Accept': 'application/json' }
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    const data = await response.json();
    if (data.message === 'LoginRequired') throw new Error('Token expired');

    return data;
}

async function main() {
    console.log('========================================');
    console.log('   Get Notes Auto Sync');
    console.log('========================================\n');

    if (!fs.existsSync(CONFIG.outputDir)) {
        fs.mkdirSync(CONFIG.outputDir, { recursive: true });
        console.log(`📁 Created output directory: ${CONFIG.outputDir}\n`);
    }

    // Load state
    let syncedIds = [];
    if (fs.existsSync(CONFIG.syncStateFile)) {
        syncedIds = JSON.parse(fs.readFileSync(CONFIG.syncStateFile, 'utf8')).syncedIds || [];
    }
    console.log(`📊 Previously synced: ${syncedIds.length} notes\n`);

    // Fetch notes using cursor pagination
    let allNotes = [];
    let sinceId = null;
    let hasMore = true;
    let page = 0;

    console.log('📋 Fetching notes list...');

    while (hasMore) {
        let url = `${CONFIG.baseUrl}${CONFIG.listEndpoint}?limit=${CONFIG.pageSize}&sort=create_desc`;
        if (sinceId) {
            url += `&since_id=${sinceId}`;
        }

        try {
            const data = await fetchWithAuth(url);
            const notes = data.c.list || [];

            if (notes.length === 0) {
                hasMore = false;
            } else {
                page++;
                process.stdout.write('.');
                allNotes = allNotes.concat(notes);
                sinceId = notes[notes.length - 1].note_id;

                await delay(CONFIG.delayMs);
            }
        } catch (e) {
            console.error(`\n❌ Error fetching list: ${e.message}`);
            break;
        }
    }

    console.log(`\n\n📁 Found total ${allNotes.length} notes on server.\n`);

    // Deduplicate fetched list (just in case)
    const uniqueNotes = [];
    const seenIds = new Set();
    for (const note of allNotes) {
        if (!seenIds.has(note.note_id)) {
            seenIds.add(note.note_id);
            uniqueNotes.push(note);
        }
    }

    // Filter new notes
    const newNotes = uniqueNotes.filter(n => !syncedIds.includes(n.note_id));
    console.log(`🆕 New notes to sync: ${newNotes.length}\n`);

    if (newNotes.length === 0) {
        console.log('✅ All up to date.');
        return;
    }

    // Sync loop
    console.log('📥 Starting sync...\n');
    let savedCount = 0;
    let transcriptCount = 0;

    for (let i = 0; i < newNotes.length; i++) {
        const note = newNotes[i];
        const dateStr = note.created_at?.split(' ')[0] || '';
        console.log(`[${i + 1}/${newNotes.length}] ${dateStr} ${note.title || 'Untitled'}`);

        try {
            const detailUrl = `${CONFIG.baseUrl}${CONFIG.detailEndpoint}${note.note_id}`;
            const detail = (await fetchWithAuth(detailUrl)).c;

            let transcript = null;
            if (CONFIG.fetchOriginal) {
                try {
                    const origUrl = `${CONFIG.baseUrl}${CONFIG.originalEndpoint}${note.note_id}/original`;
                    const origData = (await fetchWithAuth(origUrl)).c;
                    transcript = formatOriginalTranscript(origData);
                    if (transcript) {
                        console.log(`  [Transcribed] ✓`);
                        transcriptCount++;
                    }
                } catch (e) { }
                await delay(CONFIG.delayMs);
            }

            const filename = saveNote(detail, transcript);
            console.log(`  [Saved] ${filename}`);
            syncedIds.push(note.note_id);
            savedCount++;

        } catch (e) {
            console.log(`  ⚠️ Failed: ${e.message}`);
        }

        if (i < newNotes.length - 1) await delay(CONFIG.delayMs);
    }

    // Save state
    fs.writeFileSync(CONFIG.syncStateFile, JSON.stringify({
        syncedIds,
        lastSyncTime: new Date().toISOString()
    }, null, 2), 'utf8');

    console.log('\n========================================');
    console.log(`📊 Sync Completed!`);
    console.log(`   ✅ Saved: ${savedCount}`);
    console.log(`   📝 With Transcripts: ${transcriptCount}`);
    console.log('========================================\n');
}

main().catch(console.error);
