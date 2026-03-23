import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import ejs from 'ejs';
import { ENV } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TRANSCRIPTS_DIR = path.join(ROOT_DIR, 'public', 'transcripts');
const ATTACHMENTS_DIR = path.join(TRANSCRIPTS_DIR, 'attachments');
const VIEWS_DIR = path.join(ROOT_DIR, 'views');

/**
 * Downloads a file from a URL to a destination path.
 */
async function downloadFile(url, dest) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(buffer));
}

/**
 * Generates a transcript for a given channel and messages.
 */
export async function generateTranscript(channel, messages, guildId) {
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const transcriptId = `${guildId}-${randomSuffix}`;
    const outputDir = path.join(TRANSCRIPTS_DIR);
    const attachmentOutputDir = path.join(ATTACHMENTS_DIR, transcriptId);

    if (!fs.existsSync(attachmentOutputDir)) {
        fs.mkdirSync(attachmentOutputDir, { recursive: true });
    }

    const processedMessages = [];

    for (const m of messages) {
        // 1. Process attachments
        const attachments = [];
        if (m.attachments.size > 0) {
            for (const [id, att] of m.attachments) {
                const ext = path.extname(att.name) || '.bin';
                const filename = `${id}${ext}`;
                const dest = path.join(attachmentOutputDir, filename);
                
                try {
                    await downloadFile(att.url, dest);
                    const relativeUrl = `/transcripts/attachments/${transcriptId}/${filename}`;
                    
                    attachments.push({
                        name: att.name,
                        url: relativeUrl,
                        size: `${(att.size / 1024).toFixed(1)} KB`,
                        type: att.contentType?.startsWith('image/') ? 'image' : 'file'
                    });
                } catch (err) {
                    console.error(`[TRANSCRIPT] Failed to download attachment ${att.url}:`, err);
                    // Fallback to original URL even if it might break later
                    attachments.push({
                        name: att.name,
                        url: att.url,
                        size: `${(att.size / 1024).toFixed(1)} KB`,
                        type: att.contentType?.startsWith('image/') ? 'image' : 'file'
                    });
                }
            }
        }

        // 2. Process embeds
        const embeds = m.embeds.map(e => ({
            title: e.title,
            description: e.description?.replace(/\n/g, '<br>'),
            color: e.color ? `#${e.color.toString(16).padStart(6, '0')}` : null
        }));

        // 3. Process content (basic markdown to HTML)
        let content = (m.cleanContent || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/\n/g, '<br>');

        // Bold
        content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Italic
        content = content.replace(/\*(.*?)\*/g, '<em>$1</em>');
        // Underline
        content = content.replace(/__(.*?)__/g, '<u>$1</u>');

        processedMessages.push({
            authorName: m.member?.displayName || m.author.displayName || m.author.username,
            authorAvatar: m.author.displayAvatarURL({ size: 64 }),
            authorColor: m.member?.displayHexColor !== '#000000' ? m.member?.displayHexColor : null,
            timestamp: m.createdAt.toLocaleString('ja-JP'),
            content: content,
            attachments: attachments,
            embeds: embeds
        });
    }

    // Render HTML
    const html = await ejs.renderFile(path.join(VIEWS_DIR, 'transcript.ejs'), {
        channelName: channel.name,
        transcriptId: transcriptId,
        createdDate: new Date().toLocaleString('ja-JP'),
        messages: processedMessages
    });

    const filePath = path.join(TRANSCRIPTS_DIR, `${transcriptId}.html`);
    fs.writeFileSync(filePath, html);

    const publicUrl = ENV.PUBLIC_URL || `http://localhost:${ENV.PORT}`;
    const webUrl = `${publicUrl.replace(/\/+$/, '')}/transcripts/${transcriptId}.html`;

    return {
        transcriptId,
        filePath,
        webUrl,
        html
    };
}
