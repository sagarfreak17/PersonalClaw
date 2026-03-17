import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { Skill, SkillMeta } from '../types/skill.js';
import { skillLock } from '../core/skill-lock.js';

// pdfjs-dist for text extraction (pure JS, no native deps)
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '';

const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');

async function ensureOutputsDir() {
  if (!existsSync(OUTPUTS_DIR)) {
    await mkdir(OUTPUTS_DIR, { recursive: true });
  }
}

async function extractText(filePath: string): Promise<string> {
  const data = new Uint8Array(await readFile(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: any) => item.str).join(' ');
    pages.push(`--- Page ${i} ---\n${text}`);
  }
  return pages.join('\n\n');
}

async function getMetadata(filePath: string): Promise<object> {
  const bytes = await readFile(filePath);
  const doc = await PDFDocument.load(bytes);
  const data = new Uint8Array(bytes);
  const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
  return {
    pageCount: doc.getPageCount(),
    title: doc.getTitle() ?? null,
    author: doc.getAuthor() ?? null,
    subject: doc.getSubject() ?? null,
    creator: doc.getCreator() ?? null,
    producer: doc.getProducer() ?? null,
    creationDate: doc.getCreationDate() ?? null,
    modificationDate: doc.getModificationDate() ?? null,
    // @ts-ignore
    pdfVersion: (pdfDoc as any)._pdfInfo?.version ?? null,
  };
}

async function mergePdfs(inputPaths: string[], outputName: string): Promise<string> {
  await ensureOutputsDir();
  const merged = await PDFDocument.create();
  for (const filePath of inputPaths) {
    const bytes = await readFile(filePath);
    const doc = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  const outPath = path.join(OUTPUTS_DIR, outputName.endsWith('.pdf') ? outputName : `${outputName}.pdf`);
  await writeFile(outPath, await merged.save());
  return outPath;
}

async function splitPdf(filePath: string, ranges: string): Promise<string[]> {
  await ensureOutputsDir();
  const bytes = await readFile(filePath);
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  const results: string[] = [];

  // ranges like "1-3,5,7-9" (1-indexed)
  const parts = ranges.split(',').map(s => s.trim());
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let pageIndices: number[] = [];
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n.trim()) - 1);
      for (let p = start; p <= Math.min(end, total - 1); p++) pageIndices.push(p);
    } else {
      pageIndices = [parseInt(part) - 1];
    }
    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(src, pageIndices);
    copied.forEach(p => newDoc.addPage(p));
    const outName = `split_part${i + 1}.pdf`;
    const outPath = path.join(OUTPUTS_DIR, outName);
    await writeFile(outPath, await newDoc.save());
    results.push(outPath);
  }
  return results;
}

async function rotatePdf(filePath: string, rotationDeg: number, outputName?: string): Promise<string> {
  await ensureOutputsDir();
  const bytes = await readFile(filePath);
  const doc = await PDFDocument.load(bytes);
  doc.getPages().forEach(page => {
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + rotationDeg) % 360));
  });
  const base = outputName ?? `rotated_${path.basename(filePath)}`;
  const outPath = path.join(OUTPUTS_DIR, base.endsWith('.pdf') ? base : `${base}.pdf`);
  await writeFile(outPath, await doc.save());
  return outPath;
}

async function addWatermark(filePath: string, text: string, outputName?: string): Promise<string> {
  await ensureOutputsDir();
  const bytes = await readFile(filePath);
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    page.drawText(text, {
      x: width / 2 - (text.length * 12),
      y: height / 2,
      size: 48,
      font,
      color: rgb(0.75, 0.75, 0.75),
      opacity: 0.35,
      rotate: degrees(45),
    });
  }
  const base = outputName ?? `watermarked_${path.basename(filePath)}`;
  const outPath = path.join(OUTPUTS_DIR, base.endsWith('.pdf') ? base : `${base}.pdf`);
  await writeFile(outPath, await doc.save());
  return outPath;
}

async function createPdf(content: string, outputName: string): Promise<string> {
  await ensureOutputsDir();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 11;
  const lineHeight = 16;
  const margin = 50;

  const lines = content.split('\n');
  let page = doc.addPage();
  let { width, height } = page.getSize();
  let y = height - margin;

  for (const rawLine of lines) {
    if (y < margin + lineHeight) {
      page = doc.addPage();
      ({ width, height } = page.getSize());
      y = height - margin;
    }
    const isBold = rawLine.startsWith('##') || rawLine.startsWith('**');
    const cleanLine = rawLine.replace(/^#+\s*/, '').replace(/\*\*/g, '');
    const usedFont = isBold ? boldFont : font;
    const usedSize = isBold ? 13 : fontSize;

    // Word-wrap
    const maxWidth = width - margin * 2;
    const words = cleanLine.split(' ');
    let currentLine = '';
    for (const word of words) {
      const test = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = usedFont.widthOfTextAtSize(test, usedSize);
      if (testWidth > maxWidth && currentLine) {
        page.drawText(currentLine, { x: margin, y, size: usedSize, font: usedFont, color: rgb(0, 0, 0) });
        y -= lineHeight;
        currentLine = word;
        if (y < margin + lineHeight) {
          page = doc.addPage();
          ({ width, height } = page.getSize());
          y = height - margin;
        }
      } else {
        currentLine = test;
      }
    }
    if (currentLine) {
      page.drawText(currentLine, { x: margin, y, size: usedSize, font: usedFont, color: rgb(0, 0, 0) });
    }
    y -= lineHeight;
  }

  const outPath = path.join(OUTPUTS_DIR, outputName.endsWith('.pdf') ? outputName : `${outputName}.pdf`);
  await writeFile(outPath, await doc.save());
  return outPath;
}

async function extractPages(filePath: string, pages: string, outputName?: string): Promise<string> {
  await ensureOutputsDir();
  const bytes = await readFile(filePath);
  const src = await PDFDocument.load(bytes);
  const newDoc = await PDFDocument.create();
  const pageIndices = pages.split(',').map(p => parseInt(p.trim()) - 1);
  const copied = await newDoc.copyPages(src, pageIndices);
  copied.forEach(p => newDoc.addPage(p));
  const base = outputName ?? `extracted_pages.pdf`;
  const outPath = path.join(OUTPUTS_DIR, base.endsWith('.pdf') ? base : `${base}.pdf`);
  await writeFile(outPath, await newDoc.save());
  return outPath;
}

// ─── Skill Export ────────────────────────────────────────────────────────────

export const pdfSkill: Skill = {
  name: 'manage_pdf',
  description: `Comprehensive PDF skill. Actions:
- extract_text: Extract all text from a PDF file.
- metadata: Get PDF metadata (title, author, page count, dates, etc).
- merge: Merge multiple PDF files into one.
- split: Split a PDF into parts by page ranges (e.g. "1-3,4-6").
- rotate: Rotate all pages by 90, 180, or 270 degrees.
- watermark: Add a diagonal text watermark to all pages.
- create: Create a new PDF from plain text or markdown-like content.
- extract_pages: Extract specific pages into a new PDF.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['extract_text', 'metadata', 'merge', 'split', 'rotate', 'watermark', 'create', 'extract_pages'],
        description: 'The PDF operation to perform.',
      },
      file_path: {
        type: 'string',
        description: 'Absolute path to the input PDF file (required for most actions).',
      },
      file_paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of absolute PDF paths for merge action.',
      },
      output_name: {
        type: 'string',
        description: 'Output filename (without path). Saved to outputs/ folder. Defaults to a sensible name.',
      },
      rotation_degrees: {
        type: 'number',
        description: 'Degrees to rotate (90, 180, 270) for rotate action.',
      },
      watermark_text: {
        type: 'string',
        description: 'Text to use as watermark.',
      },
      ranges: {
        type: 'string',
        description: 'Page ranges for split (e.g. "1-3,4-6,7") or pages for extract_pages (e.g. "1,3,5"). 1-indexed.',
      },
      content: {
        type: 'string',
        description: 'Plain text or simple markdown content for create action.',
      },
    },
    required: ['action'],
  },

  run: async (args: any, meta: SkillMeta): Promise<any> => {
    const { action, file_path, file_paths, output_name, rotation_degrees, watermark_text, ranges, content } = args;
    const writeActions = new Set(['merge', 'split', 'rotate', 'watermark', 'create', 'extract_pages']);

    // Write actions that produce output files get a per-path write lock
    if (writeActions.has(action) && output_name) {
      const absolutePath = path.resolve(OUTPUTS_DIR, output_name.endsWith('.pdf') ? output_name : `${output_name}.pdf`);
      const lockKey = `files:${absolutePath}` as const;
      let release: (() => void) | undefined;
      try {
        release = await skillLock.acquireWrite(lockKey, {
          agentId: meta.agentId, conversationId: meta.conversationId,
          conversationLabel: meta.conversationLabel,
          operation: `pdf:${action}:${absolutePath}`, acquiredAt: new Date(),
        });
        return await executePdfAction(action, file_path, file_paths, output_name, rotation_degrees, watermark_text, ranges, content);
      } catch (err: any) {
        return { success: false, error: err.message };
      } finally {
        release?.();
      }
    }

    // Read-only actions or write actions without explicit output_name — no lock needed
    try {
      return await executePdfAction(action, file_path, file_paths, output_name, rotation_degrees, watermark_text, ranges, content);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};

async function executePdfAction(
  action: string, file_path: string, file_paths: string[],
  output_name: string, rotation_degrees: number,
  watermark_text: string, ranges: string, content: string
): Promise<any> {
  switch (action) {
    case 'extract_text': {
      if (!file_path) return { success: false, error: 'file_path required' };
      const text = await extractText(file_path);
      return { success: true, text, char_count: text.length };
    }
    case 'metadata': {
      if (!file_path) return { success: false, error: 'file_path required' };
      const pdfMeta = await getMetadata(file_path);
      return { success: true, metadata: pdfMeta };
    }
    case 'merge': {
      if (!file_paths?.length) return { success: false, error: 'file_paths array required' };
      const out = await mergePdfs(file_paths, output_name ?? 'merged.pdf');
      return { success: true, output_path: out };
    }
    case 'split': {
      if (!file_path) return { success: false, error: 'file_path required' };
      if (!ranges) return { success: false, error: 'ranges required (e.g. "1-3,4-6")' };
      const parts = await splitPdf(file_path, ranges);
      return { success: true, output_paths: parts };
    }
    case 'rotate': {
      if (!file_path) return { success: false, error: 'file_path required' };
      if (!rotation_degrees) return { success: false, error: 'rotation_degrees required' };
      const out = await rotatePdf(file_path, rotation_degrees, output_name);
      return { success: true, output_path: out };
    }
    case 'watermark': {
      if (!file_path) return { success: false, error: 'file_path required' };
      if (!watermark_text) return { success: false, error: 'watermark_text required' };
      const out = await addWatermark(file_path, watermark_text, output_name);
      return { success: true, output_path: out };
    }
    case 'create': {
      if (!content) return { success: false, error: 'content required' };
      const out = await createPdf(content, output_name ?? 'created.pdf');
      return { success: true, output_path: out };
    }
    case 'extract_pages': {
      if (!file_path) return { success: false, error: 'file_path required' };
      if (!ranges) return { success: false, error: 'ranges required (e.g. "1,3,5")' };
      const out = await extractPages(file_path, ranges, output_name);
      return { success: true, output_path: out };
    }
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}
