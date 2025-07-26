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
  if (!emojiDb || typeof emojiDb.searchFromText !== 'function') {
    throw new Error('Failed to initialize emoji database');
  }
} catch (error) {
  console.error('Error initializing emoji database:', error);
  throw error;
}

function randomChoice(arr) {
  if (!Array.isArray(arr)) {
    throw new TypeError('Input must be an array');
  }
  if (arr.length === 0) {
    throw new Error('Array cannot be empty');
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

function isHighlighted(highlightWords, word) {
  if (!Array.isArray(highlightWords)) {
    throw new TypeError('highlightWords must be an array');
  }
  if (typeof word !== 'string') {
    throw new TypeError('word must be a string');
  }
  return highlightWords.includes(word.toLowerCase());
}

function parseTextToSegments(text, ctx, fontSize) {
  try {
    if (typeof text !== 'string') {
      throw new TypeError('Text must be a string');
    }
    if (typeof fontSize !== 'number' || fontSize <= 0) {
      throw new TypeError('Font size must be a positive number');
    }
    if (!ctx || typeof ctx.measureText !== 'function') {
      throw new TypeError('Invalid canvas context');
    }
    const segments = [];
    const emojiSize = fontSize * 1.2;
    const emojiData = emojiDb.searchFromText({ input: text, fixCodePoints: true });
    let currentIndex = 0;
    const processPlainText = (plainText) => {
      if (!plainText) return;
      const parts = plainText.split(/(\s+)/);
      parts.forEach(part => {
        if (!part) return;
        if (/\s/.test(part)) {
          segments.push({
            type: 'whitespace',
            content: ' ',
            width: ctx.measureText(' ').width * part.length
          });
        } else {
          segments.push({
            type: 'text',
            content: part,
            width: ctx.measureText(part).width
          });
        }
      });
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
      if (!segment || typeof segment.width !== 'number') {
        throw new TypeError('Invalid segment format');
      }
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
    console.error('Error in rebuildLinesFromSegments:', error);
    throw error;
  }
}

async function bratVidGenerator(text, width, height, bgColor = "#FFFFFF", textColor = "#000000") {
  try {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Text must be a non-empty string');
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
    let fontSize = 100;
    let finalLines = [];
    let lineHeight = 0;
    const tempCanvas = createCanvas(1, 1);
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) {
      throw new Error('Failed to create canvas context');
    }
    let sizeFound = false;
    while (fontSize > 10) {
      tempCtx.font = `bold ${fontSize}px Arial`;
      const segments = parseTextToSegments(text, tempCtx, fontSize);
      const lines = rebuildLinesFromSegments(segments, availableWidth);
      let isTooWide = false;
      for (const line of lines) {
        const lineWidth = line.reduce((sum, seg) => sum + seg.width, 0);
        if (lineWidth > availableWidth) {
          isTooWide = true;
          break;
        }
      }
      const currentLineHeight = fontSize * 1.2;
      const totalTextHeight = lines.length * currentLineHeight;
      if (totalTextHeight <= height - (padding * 2) && !isTooWide) {
        finalLines = lines;
        lineHeight = currentLineHeight;
        sizeFound = true;
        break;
      }
      fontSize -= 5;
    }
    if (!sizeFound) {
      throw new Error('Text is too large for the specified dimensions');
    }
    let frames = [];
    const allContentSegments = finalLines.flat().filter(seg => seg.type !== 'whitespace');
    for (let i = 1; i <= allContentSegments.length; i++) {
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to create canvas context');
      }
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.textBaseline = 'top';
      const totalTextBlockHeight = finalLines.length * lineHeight;
      const startY = (height - totalTextBlockHeight) / 2;
      let contentDrawnCount = 0;
      for (let j = 0; j < finalLines.length; j++) {
        const line = finalLines[j];
        const positionY = startY + (j * lineHeight);
        const lineContent = line.filter(s => s.type !== 'whitespace');
        if (lineContent.length <= 1) {
          let positionX = padding;
          for (const segment of line) {
            if (contentDrawnCount >= i) break;
            await drawSegment(ctx, segment, positionX, positionY, fontSize, lineHeight, textColor, emojiCache);
            positionX += segment.width;
            if (segment.type !== 'whitespace') contentDrawnCount++;
          }
        } else {
          const totalContentWidth = lineContent.reduce((sum, seg) => sum + seg.width, 0);
          const numberOfGaps = lineContent.length - 1;
          const spaceBetween = (availableWidth - totalContentWidth) / numberOfGaps;
          let positionX = padding;

          for (const segment of line) {
            if (contentDrawnCount >= i) break;
            await drawSegment(ctx, segment, positionX, positionY, fontSize, lineHeight, textColor, emojiCache);
            if (segment.type === 'whitespace') {
              positionX += spaceBetween;
            } else {
              positionX += segment.width;
              contentDrawnCount++;
            }
          }
        }
        if (contentDrawnCount >= i) break;
      }
      try {
        const frameBuffer = canvas.toBuffer('image/png');
        frames.push(frameBuffer);
      } catch (error) {
        console.error('Error converting canvas to buffer:', error);
        throw error;
      }
    }
    return frames;
  } catch (error) {
    console.error('Error in bratVidGenerator:', error);
    throw error;
  }
}

async function drawSegment(ctx, segment, x, y, fontSize, lineHeight, textColor, emojiCache) {
  try {
    if (!ctx || typeof ctx.fillText !== 'function') {
      throw new Error('Invalid canvas context');
    }
    if (!segment || typeof segment.type !== 'string') {
      throw new Error('Invalid segment object');
    }
    ctx.strokeStyle = 'black';
    ctx.lineWidth = Math.max(2, fontSize / 15);
    ctx.lineJoin = 'round';

    if (segment.type === 'text') {
      if (typeof segment.content !== 'string') {
        throw new Error('Invalid text segment content');
      }
      ctx.strokeText(segment.content, x, y);
      ctx.fillStyle = textColor;
      ctx.fillText(segment.content, x, y);
    } else if (segment.type === 'emoji') {
      try {
        if (!emojiCache[segment.content]) {
          throw new Error(`Emoji ${segment.content} not found in cache`);
        }
        const emojiImg = await loadImage(Buffer.from(emojiCache[segment.content], 'base64'));
        const emojiY = y + (lineHeight - fontSize) / 2;
        ctx.drawImage(emojiImg, x, emojiY, fontSize, fontSize);
      } catch (emojiError) {
        console.error(`Failed to draw emoji: ${segment.content}`, emojiError);
        ctx.fillStyle = '#EEEEEE';
        ctx.fillRect(x, y, fontSize, fontSize);
        ctx.fillStyle = textColor;
        ctx.font = `${fontSize / 3}px Arial`;
        ctx.fillText('?', x + fontSize / 3, y + fontSize / 2);
      }
    }
  } catch (error) {
    console.error('Error in drawSegment:', error);
    throw error;
  }
}

async function bratGenerator(teks, highlightWords = []) {
  let canvas, image;
  try {
    if (typeof teks !== 'string' || teks.trim().length === 0) {
      throw new Error('Text must be a non-empty string');
    }
    if (!Array.isArray(highlightWords)) {
      throw new TypeError('highlightWords must be an array');
    }
    const allEmojiImages = await emojiImageByBrandPromise;
    const emojiCache = allEmojiImages["apple"] || {};
    let width = 512;
    let height = 512;
    let margin = 20;
    let verticalPadding = 5;
    canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error('Failed to create canvas context');
    }
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    let fontSize = 100;
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
      let isTooWide = false;
      for (const line of lines) {
        const lineWidth = line.reduce((sum, seg) => sum + seg.width, 0);
        if (lineWidth > availableWidth) {
          isTooWide = true;
          break;
        }
      }
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
    if (finalFontSize === 0) {
      throw new Error('Text is too large for the specified dimensions');
    }
    const randomWarna = ["blue", "green", "orange", "purple", "red"];
    const crot = randomChoice(randomWarna);
    const totalFinalHeight = finalLines.length * lineHeight;
    let y = (height - totalFinalHeight) / 2;
    for (const [index, line] of finalLines.entries()) {
      let x = margin;
      const contentSegments = line.filter(seg => seg.type === 'text' || seg.type === 'emoji');
      if (contentSegments.length <= 1) {
        for (const segment of line) {
          if (segment.type === 'text') {
            ctx.font = `${finalFontSize}px Arial`;
            ctx.fillStyle = isHighlighted(highlightWords, segment.content) ? crot : "black";
            ctx.fillText(segment.content, x, y);
          } else if (segment.type === 'emoji') {
            const emojiSize = finalFontSize * 1.2;
            const emojiY = y + (lineHeight - emojiSize) / 2;
            try {
              if (!emojiCache[segment.content]) {
                throw new Error(`Emoji ${segment.content} not found in cache`);
              }
              const emojiImg = await loadImage(Buffer.from(emojiCache[segment.content], 'base64'));
              ctx.drawImage(emojiImg, x, emojiY, emojiSize, emojiSize);
            } catch (emojiError) {
              console.error(`Failed to draw emoji: ${segment.content}`, emojiError);
              ctx.fillStyle = '#EEEEEE';
              ctx.fillRect(x, y, emojiSize, emojiSize);
              ctx.fillStyle = "black";
              ctx.font = `${finalFontSize / 3}px Arial`;
              ctx.fillText('?', x + emojiSize / 3, y + emojiSize / 2);
            }
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
          if (segment.type === 'text') {
            ctx.font = `${finalFontSize}px Arial`;
            ctx.fillStyle = isHighlighted(highlightWords, segment.content) ? crot : "black";
            ctx.fillText(segment.content, currentX, y);
          } else if (segment.type === 'emoji') {
            const emojiSize = finalFontSize * 1.2;
            const emojiY = y + (lineHeight - emojiSize) / 2;
            try {
              if (!emojiCache[segment.content]) {
                throw new Error(`Emoji ${segment.content} not found in cache`);
              }
              const emojiImg = await loadImage(Buffer.from(emojiCache[segment.content], 'base64'));
              ctx.drawImage(emojiImg, currentX, emojiY, emojiSize, emojiSize);
            } catch (emojiError) {
              console.error(`Failed to draw emoji: ${segment.content}`, emojiError);
              ctx.fillStyle = '#EEEEEE';
              ctx.fillRect(currentX, y, emojiSize, emojiSize);
              ctx.fillStyle = "black";
              ctx.font = `${finalFontSize / 3}px Arial`;
              ctx.fillText('?', currentX + emojiSize / 3, y + emojiSize / 2);
            }
          }
          currentX += segment.width;
          if (i < numberOfGaps) {
            currentX += spacePerGap;
          }
        }
      }
      y += lineHeight;
    }
    let buffer;
    try {
      buffer = canvas.toBuffer("image/png");
    } catch (error) {
      console.error('Error converting canvas to buffer:', error);
      throw error;
    }
    try {
      const blurredBuffer = await sharp(buffer)
        .blur(3)
        .toBuffer();
      return blurredBuffer;
    } catch (error) {
      console.error('Error processing image with Jimp:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in bratGenerator:', error);
    throw error;
  } finally {
    if (image && typeof image.dispose === 'function') {
      image.dispose();
    }
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
          console.log('Video creation complete!');
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

module.exports = {
  randomChoice,
  bratGenerator,
  bratVidGenerator,
  generateAnimatedBratVid
};