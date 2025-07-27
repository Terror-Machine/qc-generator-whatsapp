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

function isHighlighted(highlightWords, word) {
  try {
    if (!Array.isArray(highlightWords)) throw new TypeError('highlightWords must be an array');
    if (typeof word !== 'string') throw new TypeError('word must be a string');
    return highlightWords.includes(word.toLowerCase());
  } catch (error) {
    console.error('Error in isHighlighted: ', error);
    throw error;
  }
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
      const tokenizerRegex = /\*([^*]+)\*|(\s+)|([^\s*]+)/g;
      let match;
      while ((match = tokenizerRegex.exec(plainText)) !== null) {
        const [fullMatch, boldContent, whitespaceContent, textContent] = match;
        if (boldContent) {
          ctx.font = `bold ${fontSize}px Arial`;
          segments.push({
            type: 'bold',
            content: boldContent,
            width: ctx.measureText(boldContent).width
          });
          ctx.font = `${fontSize}px Arial`;
        } else if (whitespaceContent) {
          segments.push({
            type: 'whitespace',
            content: ' ',
            width: ctx.measureText(' ').width * whitespaceContent.length
          });
        } else if (textContent) {
          segments.push({
            type: 'text',
            content: textContent,
            width: ctx.measureText(textContent).width
          });
        }
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
    if (!Array.isArray(segments)) {
      throw new TypeError('Segments must be an array');
    }
    if (typeof maxWidth !== 'number' || maxWidth <= 0) {
      throw new TypeError('Max width must be a positive number');
    }
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
      if (segment.type === 'whitespace' && currentLine.length === 0) {
        return;
      }
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
      if (typeof tempFrameDir !== 'string' || typeof outputPath !== 'string') {
        throw new TypeError('Directory and path must be strings');
      }
      if (!fs.existsSync(tempFrameDir)) {
        throw new Error(`Temporary frame directory not found: ${tempFrameDir}`);
      }
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
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Text must be a non-empty string');
    }
    if (!Array.isArray(highlightWords)) {
      throw new TypeError('highlightWords must be an array.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error('Width and height must be positive integers');
    }
    if (!/^#[0-9A-F]{6}$/i.test(bgColor) || !/^#[0-9A-F]{6}$/i.test(textColor)) {
      throw new Error('Colors must be in hex format (#RRGGBB)');
    }
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
    for (let segmentCount = 1; segmentCount <= allSegments.length; segmentCount++) {
      const currentSegments = allSegments.slice(0, segmentCount);
      let fontSize = 200;
      let finalLines = [];
      let lineHeight = 0;
      const lineHeightMultiplier = 1.3;
      let sizeFound = false;
      while (fontSize > 10) {
        tempCtx.font = `${fontSize}px Arial`;
        const segmentsForSizing = currentSegments.map(seg => {
          if (seg.type === 'text') {
            return { ...seg, width: tempCtx.measureText(seg.content).width };
          }
          if (seg.type === 'bold') {
            tempCtx.font = `bold ${fontSize}px Arial`;
            const boldWidth = tempCtx.measureText(seg.content).width;
            tempCtx.font = `${fontSize}px Arial`;
            return { ...seg, width: boldWidth };
          }
          if (seg.type === 'emoji') {
            return { ...seg, width: fontSize * 1.2 };
          }
          return seg;
        });
        const lines = rebuildLinesFromSegments(segmentsForSizing, availableWidth);
        let isTooWide = lines.some(line => line.reduce((sum, seg) => sum + seg.width, 0) > availableWidth);
        const currentLineHeight = fontSize * lineHeightMultiplier;
        const totalTextHeight = lines.length * currentLineHeight;
        if (totalTextHeight <= height - (padding * 2) && !isTooWide) {
          finalLines = lines;
          lineHeight = currentLineHeight;
          sizeFound = true;
          break;
        }
        fontSize -= 2;
      }
      if (!sizeFound) {
        fontSize = 10;
        tempCtx.font = `${fontSize}px Arial`;
        const segmentsForSizing = currentSegments.map(seg => {
          if (seg.type === 'text') return { ...seg, width: tempCtx.measureText(seg.content).width };
          if (seg.type === 'bold') {
            tempCtx.font = `bold ${fontSize}px Arial`;
            const boldWidth = tempCtx.measureText(seg.content).width;
            tempCtx.font = `${fontSize}px Arial`;
            return { ...seg, width: boldWidth };
          }
          if (seg.type === 'emoji') return { ...seg, width: fontSize * 1.2 };
          return seg;
        });
        finalLines = rebuildLinesFromSegments(segmentsForSizing, availableWidth);
        lineHeight = fontSize * lineHeightMultiplier;
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
            ctx.font = segment.type === 'bold' ? `bold ${fontSize}px Arial` : `${fontSize}px Arial`;
            ctx.fillStyle = isHighlighted(highlightWords, segment.content) ? "red" : textColor;
            if (segment.type === 'text' || segment.type === 'bold') {
              ctx.fillText(segment.content, positionX, positionY);
            } else if (segment.type === 'emoji') {
              const emojiSize = fontSize * 1.2;
              const emojiY = positionY + (lineHeight - emojiSize) / 2;
              if (!emojiCache[segment.content]) throw new Error(`Emoji ${segment.content} tidak ditemukan di cache`);
              const emojiImg = await loadImage(Buffer.from(emojiCache[segment.content], 'base64'));
              ctx.drawImage(emojiImg, positionX, emojiY, emojiSize, emojiSize);
            }
            positionX += segment.width;
          }
        } else {
          const totalContentWidth = contentSegments.reduce((sum, seg) => sum + seg.width, 0);
          const numberOfGaps = contentSegments.length - 1;
          const spaceBetween = numberOfGaps > 0 ? (availableWidth - totalContentWidth) / numberOfGaps : 0;
          let positionX = padding;
          for (const segment of line) {
            ctx.font = segment.type === 'bold' ? `bold ${fontSize}px Arial` : `${fontSize}px Arial`;
            ctx.fillStyle = isHighlighted(highlightWords, segment.content) ? "red" : textColor;
            if (segment.type === 'text' || segment.type === 'bold') {
              ctx.fillText(segment.content, positionX, positionY);
              positionX += segment.width;
            } else if (segment.type === 'emoji') {
              const emojiSize = fontSize * 1.2;
              const emojiY = positionY + (lineHeight - emojiSize) / 2;
              if (!emojiCache[segment.content]) throw new Error(`Emoji ${segment.content} tidak ditemukan di cache`);
              const emojiImg = await loadImage(Buffer.from(emojiCache[segment.content], 'base64'));
              ctx.drawImage(emojiImg, positionX, emojiY, emojiSize, emojiSize);
              positionX += segment.width;
            }
            positionX += spaceBetween;
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
    let width = 512;
    let height = 512;
    let margin = 8;
    let verticalPadding = 8;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error('Gagal membuat konteks kanvas.');
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    let fontSize = 200;
    let lineHeightMultiplier = 1.3;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const availableWidth = width - 2 * margin;
    let finalLines = [];
    let finalFontSize = 0;
    let lineHeight = 0;
    while (fontSize > 10) {
      ctx.font = `${fontSize}px Arial`;
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
    for (const line of finalLines) {
      let x = margin;
      const contentSegments = line.filter(seg => seg.type !== 'whitespace');
      if (contentSegments.length <= 1) {
        for (const segment of line) {
          ctx.font = segment.type === 'bold' ? `bold ${finalFontSize}px Arial` : `${finalFontSize}px Arial`;
          ctx.fillStyle = isHighlighted(highlightWords, segment.content) ? "red" : "black";
          if (segment.type === 'text' || segment.type === 'bold') {
            ctx.fillText(segment.content, x, y);
          } else if (segment.type === 'emoji') {
            const emojiSize = finalFontSize * 1.2;
            const emojiY = y + (lineHeight - emojiSize) / 2;
            if (!emojiCache[segment.content]) throw new Error(`Emoji ${segment.content} tidak ditemukan di cache`);
            const emojiImg = await loadImage(Buffer.from(emojiCache[segment.content], 'base64'));
            ctx.drawImage(emojiImg, x, emojiY, emojiSize, emojiSize);
          }
          x += segment.width;
        }
      } else {
        const totalContentWidth = contentSegments.reduce((sum, seg) => sum + seg.width, 0);
        const numberOfGaps = contentSegments.length - 1;
        const spacePerGap = (availableWidth - totalContentWidth) / numberOfGaps;
        let currentX = margin;
        for (let i = 0; i < contentSegments.length; i++) {
          const segment = contentSegments[i];
          ctx.font = segment.type === 'bold' ? `bold ${finalFontSize}px Arial` : `${finalFontSize}px Arial`;
          ctx.fillStyle = isHighlighted(highlightWords, segment.content) ? "red" : "black";
          if (segment.type === 'text' || segment.type === 'bold') {
            ctx.fillText(segment.content, currentX, y);
          } else if (segment.type === 'emoji') {
            const emojiSize = finalFontSize * 1.2;
            const emojiY = y + (lineHeight - emojiSize) / 2;
            if (!emojiCache[segment.content]) throw new Error(`Emoji ${segment.content} tidak ditemukan di cache`);
            const emojiImg = await loadImage(Buffer.from(emojiCache[segment.content], 'base64'));
            ctx.drawImage(emojiImg, currentX, emojiY, emojiSize, emojiSize);
          }
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
    return error.message;
  }
}

module.exports = {
  randomChoice,
  bratGenerator,
  bratVidGenerator,
  generateAnimatedBratVid
};