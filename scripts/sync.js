#!/usr/bin/env node

/**
 * Get Notes Auto Sync v3
 *
 * Orchestrator: imports api.js (auth + fetch) and format.js (formatting + chapter injection).
 *
 * Output structure:
 *   get/YYYY-MM-DD/HHMMSS_title.md         ← Summary (short transcripts inlined)
 *   get/YYYY-MM-DD/HHMMSS_title_原文.md     ← Structured transcript with chapter headings (long only)
 */

const fs = require('fs');
const path = require('path');

const {
    fetchAllNotes,
    fetchNoteDetail,
    loadSyncState,
    saveSyncState,
    delay,
} = require('./api');

const {
    safeName,
    parseChapters,
    buildTranscript,
    needsSeparateTranscript,
    buildSummaryMarkdown,
    buildTranscriptMarkdown,
} = require('./format');

// ============================================================
// Config
// ============================================================

const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(process.cwd(), 'notes');
const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT) : 0; // 0 = sync all
const SINCE_DATE = process.env.SINCE_DATE || '2026-01-01'; // Only sync notes from this date onwards

// ============================================================
// Save a single note
// ============================================================

function saveNote(note, originalData, outputDir) {
    const createdDate = note.created_at || '';
    const dateStr = createdDate.split(' ')[0] || 'unknown-date';
    // Use HHMMSS (6 digits) for better uniqueness
    const rawTime = createdDate.split(' ')[1] || '00:00:00';
    const timeStr = rawTime.substring(0, 8).replace(/:/g, '');
    const safeTitle = safeName(note.title);
    let baseName = `${timeStr}_${safeTitle}`;

    // Create date directory
    const dateDir = path.join(outputDir, 'get', dateStr);
    if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true });
    }

    // Collision detection: if file exists, append counter
    if (fs.existsSync(path.join(dateDir, `${baseName}.md`))) {
        let counter = 2;
        while (fs.existsSync(path.join(dateDir, `${baseName}_${counter}.md`))) {
            counter++;
        }
        baseName = `${baseName}_${counter}`;
    }

    // Parse chapters from note content
    const chapters = parseChapters(note.content);

    // Build transcript with chapter injection
    const transcript = buildTranscript(originalData, chapters);

    // Determine inline vs separate
    const separate = needsSeparateTranscript(transcript);
    const transcriptFilename = separate ? `${baseName}_原文.md` : null;

    // Write summary file
    const summaryMd = buildSummaryMarkdown(note, transcript, transcriptFilename);
    const summaryPath = path.join(dateDir, `${baseName}.md`);
    fs.writeFileSync(summaryPath, summaryMd, 'utf8');

    // Write transcript file (if separate)
    if (separate && transcript) {
        const summaryFilename = `${baseName}.md`;
        const transcriptMd = buildTranscriptMarkdown(note, transcript, summaryFilename);
        fs.writeFileSync(path.join(dateDir, transcriptFilename), transcriptMd, 'utf8');
    }

    return {
        dateStr,
        summaryFilename: `${baseName}.md`,
        hasTranscript: !!transcript,
        separateTranscript: separate,
    };
}

// ============================================================
// Main sync loop
// ============================================================

async function main() {
    console.log('========================================');
    console.log('   Get Notes Auto Sync v3');
    console.log('========================================\n');

    const outputDir = OUTPUT_DIR;
    const getDir = path.join(outputDir, 'get');

    if (!fs.existsSync(getDir)) {
        fs.mkdirSync(getDir, { recursive: true });
        console.log(`📁 Created: ${getDir}\n`);
    }

    // Load sync state
    const state = loadSyncState();
    const syncedIds = new Set(state.syncedIds || []);
    console.log(`📊 Previously synced: ${syncedIds.size} notes\n`);

    // Fetch all notes list
    const allNotes = await fetchAllNotes();

    // Filter by date (only notes from SINCE_DATE onwards)
    const dateFiltered = allNotes.filter(n => {
        const dateStr = (n.created_at || '').split(' ')[0] || '';
        return dateStr >= SINCE_DATE;
    });
    console.log(`📅 Notes from ${SINCE_DATE}: ${dateFiltered.length} (skipped ${allNotes.length - dateFiltered.length} older)`);

    // Filter new notes (not yet synced)
    const newNotes = dateFiltered.filter(n => !syncedIds.has(n.note_id));
    console.log(`🆕 New notes to sync: ${newNotes.length}\n`);

    if (newNotes.length === 0) {
        console.log('✅ All up to date.');
        return;
    }

    // Apply test limit
    const toSync = TEST_LIMIT > 0 ? newNotes.slice(0, TEST_LIMIT) : newNotes;
    if (TEST_LIMIT > 0) {
        console.log(`🧪 Test mode: syncing ${toSync.length} of ${newNotes.length} notes\n`);
    }

    // Sync loop
    console.log('📥 Starting sync...\n');
    let savedCount = 0;
    let transcriptCount = 0;
    let separateCount = 0;

    for (let i = 0; i < toSync.length; i++) {
        const note = toSync[i];
        const dateStr = note.created_at?.split(' ')[0] || '';
        console.log(`[${i + 1}/${toSync.length}] ${dateStr} ${note.title || 'Untitled'}`);

        try {
            // Fetch detail + original transcript
            const { detail, originalData } = await fetchNoteDetail(note.note_id);

            // Save with chapter injection
            const result = saveNote(detail, originalData, outputDir);

            const status = [];
            if (result.hasTranscript) {
                transcriptCount++;
                status.push(result.separateTranscript ? '原文(separate)' : '原文(inline)');
                if (result.separateTranscript) separateCount++;
            }
            console.log(`  ✅ get/${result.dateStr}/${result.summaryFilename} ${status.join(' ')}`);

            // Track synced
            syncedIds.add(note.note_id);
            savedCount++;

            // Incremental state save
            saveSyncState({
                syncedIds: Array.from(syncedIds),
                lastSyncTime: new Date().toISOString(),
            });

        } catch (e) {
            console.log(`  ⚠️ Failed: ${e.message}`);
        }

        if (i < toSync.length - 1) await delay(500);
    }

    console.log('\n========================================');
    console.log(`📊 Sync Completed!`);
    console.log(`   ✅ Saved: ${savedCount}`);
    console.log(`   📝 With Transcripts: ${transcriptCount} (${separateCount} separate, ${transcriptCount - separateCount} inline)`);
    console.log('========================================\n');
}

main().catch(console.error);
