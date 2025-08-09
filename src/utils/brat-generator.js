const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const EmojiDbLib = require("emoji-db");
const ffmpeg = require('fluent-ffmpeg');
const { createCanvas, loadImage } = require('canvas');
const emojiImageByBrandPromise = require("emoji-cache");

let emojiDb;
try {
  emojiDb = new EmojiDbLib({ useDefaultDb: true });
  if (!emojiDb || typeof emojiDb.searchFromText !== 'function') throw new Error('Failed to initialize emoji database');
} catch (error) {
  console.error('Error initializing emoji database:', error);
  throw error;
}

function randomChoice(arr) {
  try {
    if (!Array.isArray(arr)) throw new TypeError('Input must be an array');
    if (arr.length === 0) throw new Error('Array cannot be empty');
    return arr[Math.floor(Math.random() * arr.length)];
  } catch (error) {
    console.error('Error in randomChoice: ', error);
    throw error;
  }
}

function isHighlighted(highlightList, segmentContent) {
  if (!segmentContent || typeof segmentContent !== 'string' || !highlightList || highlightList.length === 0) return false;
  const cleanFormatting = (str) => {
    if (str.startsWith('```') && str.endsWith('```')) return str.slice(3, -3);
    if ((str.startsWith('*_') && str.endsWith('_*')) || (str.startsWith('_*') && str.endsWith('*_'))) return str.slice(2, -2);
    if ((str.startsWith('*') && str.endsWith('*')) || (str.startsWith('_') && str.endsWith('_')) || (str.startsWith('~') && str.endsWith('~'))) return str.slice(1, -1);
    return str;
  };
  const contentLower = segmentContent.toLowerCase();
  for (const rawHighlightWord of highlightList) {
    const cleanedHighlightWord = cleanFormatting(rawHighlightWord).toLowerCase();
    if (cleanedHighlightWord === contentLower) {
      return true;
    }
  }
  return false;
}

function parseTextToSegments(text, ctx, fontSize) {
  try {
    if (typeof text !== 'string') throw new TypeError('Text must be a string');
    if (typeof fontSize !== 'number' || fontSize <= 0) throw new TypeError('Font size must be a positive number');
    if (!ctx || typeof ctx.measureText !== 'function') throw new TypeError('Invalid canvas context');
    const segments = [];
    const emojiSize = fontSize * 1.2;
    const emojiData = emojiDb.searchFromText({ input: text, fixCodePoints: true });
    let currentIndex = 0;
    const processPlainText = (plainText) => {
      if (!plainText) return;
      const splitContentIntoWords = (content, type, font) => {
        const wordRegex = /\S+|\s+/g;
        const parts = content.match(wordRegex) || [];
        parts.forEach(part => {
          const isWhitespace = /^\s+$/.test(part);
          ctx.font = font;
          segments.push({
            type: isWhitespace ? 'whitespace' : type,
            content: part,
            width: ctx.measureText(part).width
          });
        });
      };
      const tokenizerRegex = /(\*_.*?_\*|_\*.*?\*_)|(\*.*?\*)|(_.*?_)|(~.*?~)|(```.*?```)|(\s+)|([^*_~`\s]+)/g;
      let match;
      while ((match = tokenizerRegex.exec(plainText)) !== null) {
        const [fullMatch, boldItalic, bold, italic, strikethrough, monospace, whitespace, textContent] = match;
        if (boldItalic) {
          splitContentIntoWords(boldItalic.slice(2, -2), 'bolditalic', `bold italic ${fontSize}px Arial`);
        } else if (bold) {
          splitContentIntoWords(bold.slice(1, -1), 'bold', `bold ${fontSize}px Arial`);
        } else if (italic) {
          splitContentIntoWords(italic.slice(1, -1), 'italic', `italic ${fontSize}px Arial`);
        } else if (strikethrough) {
          splitContentIntoWords(strikethrough.slice(1, -1), 'strikethrough', `${fontSize}px Arial`);
        } else if (monospace) {
          splitContentIntoWords(monospace.slice(3, -3), 'monospace', `${fontSize}px 'Courier New', monospace`);
        } else if (whitespace) {
          segments.push({ type: 'whitespace', content: whitespace, width: ctx.measureText(whitespace).width });
        } else if (textContent) {
          segments.push({ type: 'text', content: textContent, width: ctx.measureText(textContent).width });
        }
        ctx.font = `${fontSize}px Arial`;
      }
    };
    emojiData.forEach(emojiInfo => {
      if (emojiInfo.offset > currentIndex) {
        const plainText = text.substring(currentIndex, emojiInfo.offset);
        processPlainText(plainText);
      }
      segments.push({
        type: 'emoji',
        content: emojiInfo.found,
        width: emojiSize,
      });
      currentIndex = emojiInfo.offset + emojiInfo.length;
    });
    if (currentIndex < text.length) {
      const remainingText = text.substring(currentIndex);
      processPlainText(remainingText);
    }
    return segments;
  } catch (error) {
    console.error('Error in parseTextToSegments:', error);
    throw error;
  }
}

function rebuildLinesFromSegments(segments, maxWidth) {
  try {
    if (!Array.isArray(segments))  throw new TypeError('Segments must be an array');
    if (typeof maxWidth !== 'number' || maxWidth <= 0) throw new TypeError('Max width must be a positive number');
    const lines = [];
    if (segments.length === 0) return lines;
    let currentLine = [];
    let currentLineWidth = 0;
    segments.forEach(segment => {
      if (!segment || typeof segment.width !== 'number') throw new TypeError('Invalid segment format');
      if (currentLineWidth + segment.width > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = [];
        currentLineWidth = 0;
      }
      if (segment.type === 'whitespace' && currentLine.length === 0) return;
      currentLine.push(segment);
      currentLineWidth += segment.width;
    });
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
    return lines;
  } catch (error) {
    console.error('Error in rebuildLinesFromSegments: ', error);
    throw error;
  }
}

function generateAnimatedBratVid(tempFrameDir, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof tempFrameDir !== 'string' || typeof outputPath !== 'string') throw new TypeError('Directory and path must be strings');
      if (!fs.existsSync(tempFrameDir)) throw new Error(`Temporary frame directory not found: ${tempFrameDir}`);
      const command = ffmpeg()
        .input(path.join(tempFrameDir, 'frame_%d.png'))
        .inputOptions('-framerate', '1.5')
        .outputOptions('-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2')
        .output(outputPath)
        .videoCodec('libwebp')
        .outputOptions('-loop', '0', '-q:v', '80', '-preset', 'default', '-an')
        .on('end', () => {
          resolve();
        })
        .on('error', (err) => {
          console.error('Error while processing video:', err);
          reject(err);
        });
      command.run();
    } catch (error) {
      console.error('Error in generateAnimatedBratVid:', error);
      reject(error);
    }
  });
}

async function bratVidGenerator(text, width, height, bgColor = "#FFFFFF", textColor = "#000000", highlightWords = []) {
  try {
    if (typeof text !== 'string' || text.trim().length === 0) throw new Error('Text must be a non-empty string');
    if (!Array.isArray(highlightWords)) throw new TypeError('highlightWords must be an array.');
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('Width and height must be positive integers');
    if (!/^#[0-9A-F]{6}$/i.test(bgColor) || !/^#[0-9A-F]{6}$/i.test(textColor)) throw new Error('Colors must be in hex format (#RRGGBB)');
    const allEmojiImages = await emojiImageByBrandPromise;
    const emojiCache = allEmojiImages["apple"] || {};
    const padding = 20;
    const availableWidth = width - (padding * 2);
    const tempCanvas = createCanvas(1, 1);
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) throw new Error('Failed to create canvas context');
    const allSegments = parseTextToSegments(text, tempCtx, 100).filter(seg => seg.type !== 'whitespace');
    if (allSegments.length === 0) throw new Error('No valid content segments found in the text');
    let frames = [];
    const recalculateSegmentWidths = (segments, fontSize, ctx) => {
      return segments.map(seg => {
        let newWidth = seg.width;
        switch (seg.type) {
          case 'bold': ctx.font = `bold ${fontSize}px Arial`; newWidth = ctx.measureText(seg.content).width; break;
          case 'italic': ctx.font = `italic ${fontSize}px Arial`; newWidth = ctx.measureText(seg.content).width; break;
          case 'bolditalic': ctx.font = `bold italic ${fontSize}px Arial`; newWidth = ctx.measureText(seg.content).width; break;
          case 'monospace': ctx.font = `${fontSize}px 'Courier New', monospace`; newWidth = ctx.measureText(seg.content).width; break;
          case 'strikethrough':
          case 'text': ctx.font = `${fontSize}px Arial`; newWidth = ctx.measureText(seg.content).width; break;
          case 'emoji': newWidth = fontSize * 1.2; break;
        }
        return { ...seg, width: newWidth };
      });
    };
    const renderSegment = async (ctx, segment, x, y, fontSize, lineHeight) => {
      ctx.fillStyle = isHighlighted(highlightWords, segment.content) ? "red" : textColor;
      switch (segment.type) {
        case 'bold': ctx.font = `bold ${fontSize}px Arial`; break;
        case 'italic': ctx.font = `italic ${fontSize}px Arial`; break;
        case 'bolditalic': ctx.font = `bold italic ${fontSize}px Arial`; break;
        case 'monospace': ctx.font = `${fontSize}px 'Courier New', monospace`; break;
        default: ctx.font = `${fontSize}px Arial`; break;
      }
      if (segment.type === 'emoji') {
        const emojiSize = fontSize * 1.2;
        const emojiY = y + (lineHeight - emojiSize) / 2;
        if (!emojiCache[segment.content]) throw new Error(`Emoji ${segment.content} tidak ditemukan`);
        const emojiImg = await loadImage(Buffer.from(emojiCache[segment.content], 'base64'));
        ctx.drawImage(emojiImg, x, emojiY, emojiSize, emojiSize);
      } else {
        ctx.fillText(segment.content, x, y);
        if (segment.type === 'strikethrough') {
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = Math.max(1, fontSize / 15);
          const lineY = y + lineHeight / 2.1;
          ctx.beginPath(); ctx.moveTo(x, lineY); ctx.lineTo(x + segment.width, lineY); ctx.stroke();
        }
      }
    };
    for (let segmentCount = 1; segmentCount <= allSegments.length; segmentCount++) {
      const currentSegments = allSegments.slice(0, segmentCount);
      let fontSize = 200;
      let finalLines = [];
      let lineHeight = 0;
      const lineHeightMultiplier = 1.3;
      while (fontSize > 10) {
        const segmentsForSizing = recalculateSegmentWidths(currentSegments, fontSize, tempCtx);
        const lines = rebuildLinesFromSegments(segmentsForSizing, availableWidth);
        const isTooWide = lines.some(line => line.reduce((sum, seg) => sum + seg.width, 0) > availableWidth);
        const currentLineHeight = fontSize * lineHeightMultiplier;
        const totalTextHeight = lines.length * currentLineHeight;
        if (totalTextHeight <= height - (padding * 2) && !isTooWide) {
          finalLines = lines;
          lineHeight = currentLineHeight;
          break;
        }
        fontSize -= 2;
      }
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to create canvas context');
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);
      ctx.textBaseline = 'top';
      const totalTextBlockHeight = finalLines.length * lineHeight;
      const startY = (height - totalTextBlockHeight) / 2;
      for (let j = 0; j < finalLines.length; j++) {
        const line = finalLines[j];
        const positionY = startY + (j * lineHeight);
        const contentSegments = line.filter(seg => seg.type !== 'whitespace');
        if (contentSegments.length <= 1) {
          let positionX = padding;
          for (const segment of line) {
            await renderSegment(ctx, segment, positionX, positionY, fontSize, lineHeight);
            positionX += segment.width;
          }
        } else {
          const totalContentWidth = contentSegments.reduce((sum, seg) => sum + seg.width, 0);
          const spaceBetween = (availableWidth - totalContentWidth) / (contentSegments.length - 1);
          let positionX = padding;
          for (let i = 0; i < contentSegments.length; i++) {
            const segment = contentSegments[i];
            await renderSegment(ctx, segment, positionX, positionY, fontSize, lineHeight);
            positionX += segment.width;
            if (i < contentSegments.length - 1) {
              positionX += spaceBetween;
            }
          }
        }
      }
      const buffer = canvas.toBuffer('image/png');
      const blurredBuffer = await sharp(buffer).blur(3).toBuffer();
      frames.push(blurredBuffer);
    }
    return frames;
  } catch (error) {
    console.error('Error in bratVidGenerator:', error);
    throw error;
  }
}

async function bratGenerator(teks, highlightWords = []) {
  try {
    if (typeof teks !== 'string' || teks.trim().length === 0) throw new Error('Teks tidak boleh kosong.');
    if (!Array.isArray(highlightWords)) throw new TypeError('highlightWords harus berupa array.');
    const allEmojiImages = await emojiImageByBrandPromise;
    const emojiCache = allEmojiImages["apple"] || {};
    let width = 512, height = 512, margin = 8, verticalPadding = 8;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error('Gagal membuat konteks kanvas.');
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let fontSize = 200;
    let lineHeightMultiplier = 1.3;
    const availableWidth = width - 2 * margin;
    let finalLines = [];
    let finalFontSize = 0;
    let lineHeight = 0;
    while (fontSize > 10) {
      const segments = parseTextToSegments(teks, ctx, fontSize);
      const lines = rebuildLinesFromSegments(segments, availableWidth);
      let isTooWide = lines.some(line => line.reduce((sum, seg) => sum + seg.width, 0) > availableWidth);
      const currentLineHeight = fontSize * lineHeightMultiplier;
      const totalTextHeight = lines.length * currentLineHeight;
      if (totalTextHeight <= height - 2 * verticalPadding && !isTooWide) {
        finalLines = lines;
        finalFontSize = fontSize;
        lineHeight = currentLineHeight;
        break;
      }
      fontSize -= 2;
    }
    if (finalLines.length === 1 && finalLines[0].length === 1 && finalLines[0][0].type === 'text') {
      const theOnlyWord = finalLines[0][0].content;
      const heightBasedSize = (height - 2 * verticalPadding) / lineHeightMultiplier;
      ctx.font = `200px Arial`;
      const referenceWidth = ctx.measureText(theOnlyWord).width;
      const widthBasedSize = (availableWidth / referenceWidth) * 200;
      finalFontSize = Math.floor(Math.min(heightBasedSize, widthBasedSize));
      lineHeight = finalFontSize * lineHeightMultiplier;
    }
    const totalFinalHeight = finalLines.length * lineHeight;
    let y = (finalLines.length === 1) ? verticalPadding : (height - totalFinalHeight) / 2;
    const renderSegment = async (segment, x, y) => {
      ctx.fillStyle = isHighlighted(highlightWords, segment.content) ? "red" : "black";
      switch (segment.type) {
        case 'bold':
          ctx.font = `bold ${finalFontSize}px Arial`;
          break;
        case 'italic':
          ctx.font = `italic ${finalFontSize}px Arial`;
          break;
        case 'bolditalic':
          ctx.font = `bold italic ${finalFontSize}px Arial`;
          break;
        case 'monospace':
          ctx.font = `${finalFontSize}px 'Courier New', monospace`;
          break;
        case 'strikethrough':
        case 'text':
        default:
          ctx.font = `${finalFontSize}px Arial`;
          break;
      }
      if (segment.type === 'emoji') {
        const emojiSize = finalFontSize * 1.2;
        const emojiY = y + (lineHeight - emojiSize) / 2;
        if (!emojiCache[segment.content]) throw new Error(`Emoji ${segment.content} tidak ditemukan di cache`);
        const emojiImg = await loadImage(Buffer.from(emojiCache[segment.content], 'base64'));
        ctx.drawImage(emojiImg, x, emojiY, emojiSize, emojiSize);
      } else {
        ctx.fillText(segment.content, x, y);
        if (segment.type === 'strikethrough') {
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = Math.max(1, finalFontSize / 15);
          const lineY = y + lineHeight / 2.1;
          ctx.beginPath();
          ctx.moveTo(x, lineY);
          ctx.lineTo(x + segment.width, lineY);
          ctx.stroke();
        }
      }
    };
    for (const line of finalLines) {
      const contentSegments = line.filter(seg => seg.type !== 'whitespace');
      if (contentSegments.length <= 1) {
        let x = margin;
        for (const segment of line) {
          await renderSegment(segment, x, y);
          x += segment.width;
        }
      } else {
        const totalContentWidth = contentSegments.reduce((sum, seg) => sum + seg.width, 0);
        const numberOfGaps = contentSegments.length - 1;
        const spacePerGap = (availableWidth - totalContentWidth) / numberOfGaps;
        let currentX = margin;
        for (let i = 0; i < contentSegments.length; i++) {
          const segment = contentSegments[i];
          await renderSegment(segment, currentX, y);
          currentX += segment.width;
          if (i < numberOfGaps) {
            currentX += spacePerGap;
          }
        }
      }
      y += lineHeight;
    }
    const buffer = canvas.toBuffer("image/png");
    const blurredBuffer = await sharp(buffer).blur(3).toBuffer();
    return blurredBuffer;
  } catch (error) {
    console.error('Terjadi error di bratGenerator:', error);
    throw error;
  }
}

module.exports = {
  randomChoice,
  bratGenerator,
  bratVidGenerator,
  generateAnimatedBratVid
};