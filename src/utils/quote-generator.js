/**
 * quote_generator.js (Versi Refactoring)
 * Versi ini difokuskan pada pembuatan gambar dengan format PNG dari path/Buffer untuk bot whatsapp...
 * Versi ini adalah hasil modifikasi dari repo: https://github.com/LyoSU/quote-api
 * special thanks to @LyoSU and all contributors on his repo.
 **/

const fs = require("fs");
const path = require("path");
const runes = require("runes");
const sharp = require("sharp");
const EmojiDbLib = require("emoji-db");
const { LRUCache } = require("lru-cache");
const emojiDb = new EmojiDbLib({ useDefaultDb: true });
const emojiImageByBrandPromise = require("emoji-cache");
const ALLOWED_MEDIA_DIRECTORY = path.resolve(__dirname, "../");
const { createCanvas, loadImage, registerFont } = require("canvas");

async function loadFont() {
  const fontsDir = path.join(__dirname, "../fonts");
  if (!fs.existsSync(fontsDir)) {
    console.error(
      `PENTING: Direktori font tidak ditemukan di '${path.resolve(fontsDir)}'.`
    );
    return;
  }
  try {
    const files = await fs.promises.readdir(fontsDir);
    if (!files || files.length === 0) {
      console.error(
        `Tidak ada font yang ditemukan di direktori '${path.resolve(
          fontsDir
        )}'.`
      );
      return;
    }
    for (const file of files) {
      try {
        registerFont(path.join(fontsDir, file), {
          family: file.replace(/\.[^/.]+$/, ""),
        });
      } catch (error) {
        console.error(`Gagal memuat font: ${path.join(fontsDir, file)}.`);
      }
    }
  } catch (err) {
    console.error("Gagal membaca direktori font:", err);
  }
}

const fontsLoadedPromise = loadFont();
const avatarCache = new LRUCache({
  max: 20,
  ttl: 1000 * 60 * 5,
});

function _normalizeColor(color) {
  const canvas = createCanvas(0, 0);
  const canvasCtx = canvas.getContext("2d");
  canvasCtx.fillStyle = color;
  return canvasCtx.fillStyle;
}
function _colorLuminance(hex, lum) {
  hex = String(hex).replace(/[^0-9a-f]/gi, "");
  if (hex.length < 6) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  lum = lum || 0;
  let rgb = "#",
    c,
    i;
  for (i = 0; i < 3; i++) {
    c = parseInt(hex.substr(i * 2, 2), 16);
    c = Math.round(Math.min(Math.max(0, c + c * lum), 255)).toString(16);
    rgb += ("00" + c).substr(c.length);
  }
  return rgb;
}
function _hexToRgb(hex) {
  return hex
    .replace(
      /^#?([a-f\d])([a-f\d])([a-f\d])$/i,
      (m, r, g, b) => "#" + r + r + g + g + b + b
    )
    .substring(1)
    .match(/.{2}/g)
    .map((x) => parseInt(x, 16));
}

class ColorContrast {
  constructor() {
    this.brightnessThreshold = 175;
  }
  hexToRgb(hex) {
    return _hexToRgb(hex);
  }
  rgbToHex([r, g, b]) {
    return `#${r.toString(16).padStart(2, "0")}${g
      .toString(16)
      .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }
  getBrightness(color) {
    const [r, g, b] = this.hexToRgb(color);
    return (r * 299 + g * 587 + b * 114) / 1000;
  }
  adjustBrightness(color, amount) {
    const [r, g, b] = this.hexToRgb(color);
    const newR = Math.max(0, Math.min(255, r + amount));
    const newG = Math.max(0, Math.min(255, g + amount));
    const newB = Math.max(0, Math.min(255, b + amount));
    return this.rgbToHex([newR, newG, newB]);
  }
  getContrastRatio(background, foreground) {
    const brightness1 = this.getBrightness(background);
    const brightness2 = this.getBrightness(foreground);
    const lightest = Math.max(brightness1, brightness2);
    const darkest = Math.min(brightness1, brightness2);
    return (lightest + 0.05) / (darkest + 0.05);
  }
  adjustContrast(background, foreground) {
    const contrastRatio = this.getContrastRatio(background, foreground);
    const brightnessDiff =
      this.getBrightness(background) - this.getBrightness(foreground);
    if (contrastRatio >= 4.5) {
      return foreground;
    } else if (brightnessDiff >= 0) {
      const amount = Math.ceil(
        (this.brightnessThreshold - this.getBrightness(foreground)) / 2
      );
      return this.adjustBrightness(foreground, amount);
    } else {
      const amount = Math.ceil(
        (this.getBrightness(foreground) - this.brightnessThreshold) / 2
      );
      return this.adjustBrightness(foreground, -amount);
    }
  }
}
class QuoteGenerate {
  constructor() {}
  async avatarImageletters(letters, color) {
    const size = 500;
    const canvas = createCanvas(size, size);
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(
      0,
      0,
      canvas.width,
      canvas.height
    );
    gradient.addColorStop(0, color[0]);
    gradient.addColorStop(1, color[1]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const drawLetters = await this.drawMultilineText(
      letters,
      null,
      size / 2,
      "#FFF",
      0,
      size,
      size * 5,
      size * 5
    );
    context.drawImage(
      drawLetters,
      (canvas.width - drawLetters.width) / 2,
      (canvas.height - drawLetters.height) / 1.5
    );
    return canvas.toBuffer();
  }
  async downloadAvatarImage(user) {
    const cacheKey = user.id;
    const avatarImageCache = avatarCache.get(cacheKey);
    if (avatarImageCache) {
      return avatarImageCache;
    }
    let avatarImage;
    try {
      if (!user.photo || (!user.photo.path && !user.photo.buffer)) {
        throw new Error(
          "Tidak ada sumber foto (path/buffer), gunakan fallback inisial."
        );
      }
      let imageSource;
      if (user.photo.buffer) {
        imageSource = user.photo.buffer;
      } else {
        const requestedPath = path.resolve(user.photo.path);
        if (!requestedPath.startsWith(ALLOWED_MEDIA_DIRECTORY)) {
          console.error(`Akses path ditolak untuk avatar: ${user.photo.path}`);
          throw new Error("Invalid avatar path specified.");
        }
        imageSource = requestedPath;
      }
      avatarImage = await loadImage(imageSource);
    } catch (error) {
      let nameletters;
      if (user.first_name && user.last_name) {
        nameletters =
          runes(user.first_name)[0] + (runes(user.last_name || "")[0] || "");
      } else {
        let name = user.first_name || user.name || user.title || "FN";
        name = name.toUpperCase();
        const nameWords = name.split(" ").filter(Boolean);
        if (nameWords.length > 1) {
          nameletters =
            runes(nameWords[0])[0] + runes(nameWords[nameWords.length - 1])[0];
        } else if (nameWords.length === 1) {
          nameletters = runes(nameWords[0])[0];
        } else {
          nameletters = "FN";
        }
      }
      const avatarColorArray = [
        ["#FF885E", "#FF516A"],
        ["#FFCD6A", "#FFA85C"],
        ["#E0A2F3", "#D669ED"],
        ["#A0DE7E", "#54CB68"],
        ["#53EDD6", "#28C9B7"],
        ["#72D5FD", "#2A9EF1"],
        ["#FFA8A8", "#FF719A"],
      ];
      const nameIndex = user.id
        ? Math.abs(user.id) % 7
        : Math.abs(user.name?.charCodeAt(0) || 1) % 7;
      const avatarColor = avatarColorArray[nameIndex];
      const avatarBuffer = await this.avatarImageletters(
        nameletters,
        avatarColor
      );
      avatarImage = await loadImage(avatarBuffer);
    }
    if (avatarImage) {
      avatarCache.set(cacheKey, avatarImage);
    }
    return avatarImage;
  }
  async downloadMediaImage(media) {
    if (!media || (!media.path && !media.buffer)) {
      console.log(
        "Media tidak memiliki sumber (path/buffer), tidak dapat diunduh."
      );
      return null;
    }
    try {
      let imageBuffer;
      if (media.buffer) {
        imageBuffer = media.buffer;
      } else {
        const requestedPath = path.resolve(media.path);
        if (!requestedPath.startsWith(ALLOWED_MEDIA_DIRECTORY)) {
          console.error(
            `Akses path ditolak (Path Traversal attempt): ${media.path}`
          );
          throw new Error("Invalid path specified.");
        }
        imageBuffer = await fs.promises.readFile(requestedPath);
      }
      return loadImage(imageBuffer);
    } catch (e) {
      console.error(`Gagal memuat media dari sumber lokal.`, e);
      return null;
    }
  }
  hexToRgb(hex) {
    return _hexToRgb(hex);
  }
  colorLuminance(hex, lum) {
    return _colorLuminance(hex, lum);
  }
  normalizeColor(color) {
    return _normalizeColor(color);
  }
  lightOrDark(color) {
    let r, g, b;
    if (color.match(/^rgb/)) {
      color = color.match(
        /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/
      );
      r = color[1];
      g = color[2];
      b = color[3];
    } else {
      color = +(
        "0x" + color.slice(1).replace(color.length < 5 && /./g, "$&$&")
      );
      r = color >> 16;
      g = (color >> 8) & 255;
      b = color & 255;
    }
    const hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
    return hsp > 127.5 ? "light" : "dark";
  }
  async drawMultilineText(
    text,
    entities,
    fontSize,
    fontColor,
    textX,
    textY,
    maxWidth,
    maxHeight,
    emojiBrand = "apple"
  ) {
    if (!text || typeof text !== "string") return createCanvas(1, 1);
    if (maxWidth > 10000) maxWidth = 10000;
    if (maxHeight > 10000) maxHeight = 10000;
    const allEmojiImages = await emojiImageByBrandPromise;
    const emojiImageJson = allEmojiImages[emojiBrand] || {};
    const fallbackEmojiImageJson = allEmojiImages["apple"] || {};
    const canvas = createCanvas(maxWidth + fontSize, maxHeight + fontSize);
    const ctx = canvas.getContext("2d");
    text = text.replace(/і/g, "i");
    const lineHeight = fontSize * 1.2;
    const charStyles = new Array(runes(text).length).fill(null).map(() => []);
    if (entities && typeof entities === "object" && Array.isArray(entities)) {
      for (const entity of entities) {
        const style = [];
        if (["pre", "code", "pre_code", "monospace"].includes(entity.type))
          style.push("monospace");
        else if (
          [
            "mention",
            "text_mention",
            "hashtag",
            "email",
            "phone_number",
            "bot_command",
            "url",
            "text_link",
          ].includes(entity.type)
        )
          style.push("mention");
        else style.push(entity.type);
        for (
          let i = entity.offset;
          i < Math.min(entity.offset + entity.length, charStyles.length);
          i++
        ) {
          if (charStyles[i]) charStyles[i].push(...style);
        }
      }
    } else if (typeof entities === "string") {
      for (let i = 0; i < charStyles.length; i++) charStyles[i].push(entities);
    }
    const styledWords = [];
    const emojiData = emojiDb.searchFromText({
      input: text,
      fixCodePoints: true,
    });
    let currentIndex = 0;
    const processPlainText = (plainText, startOffset) => {
      if (!plainText) return;
      const chars = runes(plainText);
      let currentWord = "";
      let currentStyle = JSON.stringify(charStyles[startOffset] || []);
      const pushWord = () => {
        if (currentWord) {
          styledWords.push({
            word: currentWord,
            style: JSON.parse(currentStyle),
          });
          currentWord = "";
        }
      };
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        const charIndexInOriginal = startOffset + i;
        const newStyle = JSON.stringify(charStyles[charIndexInOriginal] || []);
        if (newStyle !== currentStyle || /<br>|\n|\r|\s/.test(char)) {
          pushWord();
          currentStyle = newStyle;
        }
        if (/<br>|\n|\r/.test(char)) {
          styledWords.push({ word: "\n", style: [] });
        } else if (/\s/.test(char)) {
          styledWords.push({ word: " ", style: [] });
        } else {
          currentWord += char;
        }
      }
      pushWord();
    };
    emojiData.forEach((emojiInfo) => {
      if (emojiInfo.offset > currentIndex) {
        processPlainText(
          text.substring(currentIndex, emojiInfo.offset),
          currentIndex
        );
      }
      styledWords.push({
        word: emojiInfo.emoji,
        style: charStyles[emojiInfo.offset] || [],
        emoji: { code: emojiInfo.found },
      });
      currentIndex = emojiInfo.offset + emojiInfo.length;
    });
    if (currentIndex < text.length) {
      processPlainText(text.substring(currentIndex), currentIndex);
    }
    let lineX = textX;
    let lineY = textY;
    let textWidth = 0;
    for (let index = 0; index < styledWords.length; index++) {
      const styledWord = styledWords[index];
      let emojiImage;
      if (styledWord.emoji) {
        const emojiImageBase = emojiImageJson[styledWord.emoji.code];
        if (emojiImageBase) {
          emojiImage = await loadImage(Buffer.from(emojiImageBase, "base64"));
        } else if (fallbackEmojiImageJson[styledWord.emoji.code]) {
          emojiImage = await loadImage(
            Buffer.from(fallbackEmojiImageJson[styledWord.emoji.code], "base64")
          );
        }
      }
      let fontType = "";
      let fontName = "Noto Sans";
      let fillStyle = fontColor;
      if (styledWord.style.includes("bold")) fontType += "bold ";
      if (styledWord.style.includes("italic")) fontType += "italic ";
      if (styledWord.style.includes("monospace")) fontName = "NotoSansMono";
      if (
        styledWord.style.includes("mention") &&
        styledWord.style.includes("monospace")
      ) {
        fillStyle = "#005740";
      } else if (styledWord.style.includes("mention")) {
        fillStyle = "#007AFF";
      } else if (styledWord.style.includes("monospace")) {
        fillStyle = "#008069";
      } else {
        fillStyle = fontColor;
      }
      ctx.font = `${fontType}${fontSize}px "${fontName}"`;
      ctx.fillStyle = fillStyle;
      const isNewline = styledWord.word.match(/\n|\r/);
      const wordWidth = styledWord.emoji
        ? fontSize
        : ctx.measureText(styledWord.word).width;
      if (isNewline) {
        if (textWidth < lineX) textWidth = lineX;
        lineX = textX;
        lineY += lineHeight;
        continue;
      } else if (!styledWord.emoji && wordWidth > maxWidth) {
        for (let ci = 0; ci < styledWord.word.length; ci++) {
          const c = styledWord.word[ci];
          const charWidth = ctx.measureText(c).width;
          if (lineX + charWidth > maxWidth) {
            if (textWidth < lineX) textWidth = lineX;
            lineX = textX;
            lineY += lineHeight;
          }
          ctx.fillText(c, lineX, lineY);
          lineX += charWidth;
        }
        continue;
      }
      if (lineX + wordWidth > maxWidth && styledWord.word !== " ") {
        if (textWidth < lineX) textWidth = lineX;
        lineX = textX;
        lineY += lineHeight;
      }
      if (lineY > maxHeight) break;
      if (emojiImage) {
        const emojiYOffset = fontSize * 0.85;
        ctx.drawImage(
          emojiImage,
          lineX,
          lineY - emojiYOffset,
          fontSize,
          fontSize
        );
      } else if (styledWord.word !== " ") {
        ctx.fillText(styledWord.word, lineX, lineY);
      }
      lineX += styledWord.emoji
        ? fontSize
        : ctx.measureText(styledWord.word).width;
      if (textWidth < lineX) {
        textWidth = lineX;
      }
    }
    const finalHeight = lineY + lineHeight;
    const canvasResize = createCanvas(
      Math.ceil(textWidth),
      Math.ceil(finalHeight)
    );
    const canvasResizeCtx = canvasResize.getContext("2d");
    canvasResizeCtx.drawImage(canvas, 0, 0);
    return canvasResize;
  }
  async drawTruncatedText(
    text,
    entities,
    fontSize,
    fontColor,
    maxWidth,
    emojiBrand = "apple",
    truncationRatio = 0.95,
    truncateMaxWidth = null
  ) {
    if (!text || typeof text !== "string") return createCanvas(1, 1);
    const allEmojiImages = await emojiImageByBrandPromise;
    const emojiImageJson = allEmojiImages[emojiBrand] || {};
    const fallbackEmojiImageJson = allEmojiImages["apple"] || {};
    const canvas = createCanvas(maxWidth, fontSize * 1.7);
    const ctx = canvas.getContext("2d");
    const isLongUnbreakableUrl = () => {
      const isUrl = entities?.some(e => ['url', 'text_link'].includes(e.type));
      const noSpaces = !text.includes(' ');
      return isUrl && noSpaces && runes(text).length > 30;
    };
    const charStyles = new Array(runes(text).length).fill(null).map(() => []);
    if (entities && Array.isArray(entities)) {
      for (const entity of entities) {
        const style = [];
        if (["pre", "code", "pre_code", "monospace"].includes(entity.type)) {
          style.push("monospace");
        } else if (["mention", "text_mention", "hashtag", "email", "phone_number",
          "bot_command", "url", "text_link"].includes(entity.type)) {
          style.push("mention");
        } else {
          style.push(entity.type);
        }
        for (let i = entity.offset; i < Math.min(entity.offset + entity.length, charStyles.length); i++) {
          if (charStyles[i]) charStyles[i].push(...style);
        }
      }
    }
    const styledWords = [];
    const emojiData = emojiDb.searchFromText({ input: text, fixCodePoints: true });
    let currentIndex = 0;
    const processPlainText = (plainText, startOffset) => {
      if (!plainText) return;
      const chars = runes(plainText);
      let currentWord = "";
      let currentStyle = JSON.stringify(charStyles[startOffset] || []);
      const pushWord = () => {
        if (currentWord) {
          styledWords.push({
            word: currentWord,
            style: JSON.parse(currentStyle),
          });
          currentWord = "";
        }
      };
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        const charIndexInOriginal = startOffset + i;
        const newStyle = JSON.stringify(charStyles[charIndexInOriginal] || []);
        if (newStyle !== currentStyle || /\s/.test(char)) {
          pushWord();
          currentStyle = newStyle;
        }
        if (/\s/.test(char)) {
          styledWords.push({ word: " ", style: [] });
        } else {
          currentWord += char;
        }
      }
      pushWord();
    };
    emojiData.forEach((emojiInfo) => {
      if (emojiInfo.offset > currentIndex) {
        processPlainText(text.substring(currentIndex, emojiInfo.offset), currentIndex);
      }
      styledWords.push({
        word: emojiInfo.emoji,
        style: charStyles[emojiInfo.offset] || [],
        emoji: { code: emojiInfo.found },
      });
      currentIndex = emojiInfo.offset + emojiInfo.length;
    });
    if (currentIndex < text.length) {
      processPlainText(text.substring(currentIndex), currentIndex);
    }
    ctx.font = `${fontSize}px "Noto Sans"`;
    const ellipsisWidth = ctx.measureText("…").width;
    const areaTruncate = truncateMaxWidth ? truncateMaxWidth * truncationRatio : maxWidth * truncationRatio;
    let drawX = 0;
    let truncated = false;
    const visibleWords = [];
    for (const styledWord of styledWords) {
      let wordWidth;
      let fontType = "";
      let fontName = "Noto Sans";
      let fillStyle = fontColor;
      if (styledWord.style.includes("bold")) fontType += "bold ";
      if (styledWord.style.includes("italic")) fontType += "italic ";
      if (styledWord.style.includes("monospace")) fontName = "NotoSansMono";
      if (styledWord.style.includes("mention")) fillStyle = "#007AFF";
      ctx.font = `${fontType}${fontSize}px "${fontName}"`;
      ctx.fillStyle = fillStyle;
      if (styledWord.emoji) {
        wordWidth = fontSize;
      } else {
        wordWidth = ctx.measureText(styledWord.word).width;
        if (wordWidth > areaTruncate && styledWord.style.includes("monospace")) {
          const chars = runes(styledWord.word);
          let charCount = 0;
          for (const char of chars) {
            const charWidth = ctx.measureText(char).width;
            if (drawX + charWidth + ellipsisWidth > areaTruncate) {
              truncated = true;
              break;
            }
            visibleWords.push({
              word: char,
              style: styledWord.style,
              emoji: styledWord.emoji
            });
            drawX += charWidth;
            charCount++;
            if (charCount > 100) break;
          }
          continue;
        }
      }
      if (drawX + wordWidth + ellipsisWidth > areaTruncate && styledWord.word !== " ") {
        if (visibleWords.length > 0) {
          truncated = true;
        }
        break;
      }
      visibleWords.push(styledWord);
      drawX += wordWidth;
    }
    if (visibleWords.length === 0 && isLongUnbreakableUrl()) {
      const firstFewChars = runes(text).slice(0, 10).join('');
      visibleWords.push({
        word: firstFewChars,
        style: ["mention"]
      });
      truncated = true;
    }
    drawX = 0;
    for (const styledWord of visibleWords) {
      let fontType = "";
      let fontName = "Noto Sans";
      let fillStyle = fontColor;
      if (styledWord.style.includes("bold")) fontType += "bold ";
      if (styledWord.style.includes("italic")) fontType += "italic ";
      if (styledWord.style.includes("monospace")) {
        fontName = "NotoSansMono";
        fillStyle = "#008069";
      }
      if (styledWord.style.includes("mention")) {
        fillStyle = "#007AFF";
      }
      ctx.font = `${fontType}${fontSize}px "${fontName}"`;
      ctx.fillStyle = fillStyle;
      if (styledWord.emoji) {
        const emojiImageBase = emojiImageJson[styledWord.emoji.code] ||
          fallbackEmojiImageJson[styledWord.emoji.code];
        if (emojiImageBase) {
          const emojiImage = await loadImage(Buffer.from(emojiImageBase, "base64"));
          const emojiYOffset = fontSize * 0.85;
          ctx.drawImage(emojiImage, drawX, fontSize - emojiYOffset, fontSize, fontSize);
        }
        drawX += fontSize;
      } else {
        ctx.fillText(styledWord.word, drawX, fontSize);
        drawX += ctx.measureText(styledWord.word).width;
      }
    }
    if (truncated) {
      ctx.fillStyle = fontColor;
      ctx.font = `${fontSize}px "Noto Sans"`;
      ctx.fillText("…", drawX, fontSize);
    }
    return canvas;
  }
  drawRoundRect(color, w, h, r) {
    const x = 0;
    const y = 0;
    const canvas = createCanvas(w, h);
    const canvasCtx = canvas.getContext("2d");
    canvasCtx.fillStyle = color;
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    canvasCtx.beginPath();
    canvasCtx.moveTo(x + r, y);
    canvasCtx.arcTo(x + w, y, x + w, y + h, r);
    canvasCtx.arcTo(x + w, y + h, x, y + h, r);
    canvasCtx.arcTo(x, y + h, x, y, r);
    canvasCtx.arcTo(x, y, x + w, y, r);
    canvasCtx.closePath();
    canvasCtx.fill();
    return canvas;
  }
  drawGradientRoundRect(colorOne, colorTwo, w, h, r) {
    const x = 0;
    const y = 0;
    const canvas = createCanvas(w, h);
    const canvasCtx = canvas.getContext("2d");
    const gradient = canvasCtx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, colorOne);
    gradient.addColorStop(1, colorTwo);
    canvasCtx.fillStyle = gradient;
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    canvasCtx.beginPath();
    canvasCtx.moveTo(x + r, y);
    canvasCtx.arcTo(x + w, y, x + w, y + h, r);
    canvasCtx.arcTo(x + w, y + h, x, y + h, r);
    canvasCtx.arcTo(x, y + h, x, y, r);
    canvasCtx.arcTo(x, y, x + w, y, r);
    canvasCtx.closePath();
    canvasCtx.fill();
    return canvas;
  }
  roundImage(image, r) {
    const w = image.width;
    const h = image.height;
    const canvas = createCanvas(w, h);
    const canvasCtx = canvas.getContext("2d");
    const x = 0;
    const y = 0;
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    canvasCtx.beginPath();
    canvasCtx.moveTo(x + r, y);
    canvasCtx.arcTo(x + w, y, x + w, y + h, r);
    canvasCtx.arcTo(x + w, y + h, x, y + h, r);
    canvasCtx.arcTo(x, y + h, x, y, r);
    canvasCtx.arcTo(x, y, x + w, y, r);
    canvasCtx.save();
    canvasCtx.clip();
    canvasCtx.closePath();
    canvasCtx.drawImage(image, x, y);
    canvasCtx.restore();
    return canvas;
  }
  drawReplyLine(lineWidth, height, color) {
    const canvas = createCanvas(20, height);
    const context = canvas.getContext("2d");
    context.beginPath();
    context.moveTo(10, 0);
    context.lineTo(10, height);
    context.lineWidth = lineWidth;
    context.strokeStyle = color;
    context.stroke();
    context.closePath();
    return canvas;
  }
  trimNameOrNumber(text, maxWords = 2) {
    const maxLength = 26;
    const words = text.split(" ");
    if (words.length > maxWords) {
      text = words.slice(0, maxWords).join(" ");
    } else if (text.length > maxLength) {
      text = text.slice(0, maxLength);
    }
    return text;
  }
  formatPhoneNumber(text) {
    text = text.replace(/\D/g, '');
    if (text.startsWith('62')) {
      return `+62 ${text.slice(2, 5)}-${text.slice(5, 9)}-${text.slice(9)}`;
    }
    return text.replace(/^(\d{1,4})(\d{1,4})(\d{1,4})(\d{1,4})$/, '+$1$2$3$4');
  };
  async drawAvatar(user) {
    const avatarImage = await this.downloadAvatarImage(user);
    if (avatarImage) {
      const avatarSize = avatarImage.naturalHeight || avatarImage.height;
      const canvas = createCanvas(avatarSize, avatarSize);
      const canvasCtx = canvas.getContext("2d");
      const avatarX = 0;
      const avatarY = 0;
      canvasCtx.save();
      canvasCtx.beginPath();
      canvasCtx.arc(
        avatarX + avatarSize / 2,
        avatarY + avatarSize / 2,
        avatarSize / 2,
        0,
        Math.PI * 2,
        true
      );
      canvasCtx.clip();
      canvasCtx.closePath();
      canvasCtx.drawImage(
        avatarImage,
        avatarX,
        avatarY,
        avatarSize,
        avatarSize
      );
      canvasCtx.restore();
      return canvas;
    }
    return null;
  }
  async drawQuote(
    scale,
    backgroundColorOne,
    backgroundColorTwo,
    avatar,
    replyName,
    replyNameColor,
    finalReplyTextCanvas,
    replyNumber,
    name,
    number,
    text,
    media,
    mediaType,
    finalContentWidth,
    replyMedia,
    replyMediaType,
    replyThumbnailSize,
    fromTime,
    emojiBrand = "apple",
    gap
  ) {
    const avatarPosX = 0;
    const avatarPosY = 5 * scale;
    const avatarSize = 50 * scale;
    const indent = 14 * scale;
    const blockPosX = avatarSize + 10 * scale;
    const width = blockPosX + finalContentWidth;
    const quotedThumbW = replyMedia ? Math.min(finalContentWidth * 0.25, replyMedia.width) : 0;
    const quotedThumbH = replyMedia ? replyMedia.height * (quotedThumbW / replyMedia.width) : 0;
    const replyNameHeight = replyName?.height || 0;
    const replyNumberHeight = replyNumber?.height || 0;
    const quotedTextHeight = finalReplyTextCanvas?.height || 0;
    const replyNameBarHeight = Math.max(replyNameHeight, replyNumberHeight, 1);
    const replyQuotedHeight = Math.max(replyNameBarHeight + quotedTextHeight, quotedThumbH) + indent / 2 - 25 * scale;
    const replyBubbleWidth = finalContentWidth - indent * 2;
    const namePosX = blockPosX + indent;
    const textPosX = blockPosX + indent;
    const nameHeight = name?.height || 0;
    const numberHeight = number?.height || 0;
    const nameBarHeight = Math.max(nameHeight, numberHeight, 1);
    let namePosY = indent;
    let currentY = namePosY + nameBarHeight - 25 * scale;
    let rectHeight = currentY;
    let replyBubblePosX = textPosX;
    let replyBubblePosY = currentY;
    if (replyName && (finalReplyTextCanvas || replyMedia)) {
      currentY += replyQuotedHeight;
      rectHeight = currentY;
    }
    let mediaPosX, mediaPosY, mediaWidth, mediaHeight;
    if (media) {
      mediaWidth = finalContentWidth - indent * 2;
      mediaHeight = media.height * (mediaWidth / media.width);
      mediaPosX = textPosX;
      mediaPosY = currentY;
      currentY += mediaHeight + indent;
      rectHeight = currentY;
    }
    let textPosY = currentY;
    if (text) {
      currentY += text.height;
      rectHeight = currentY;
    }
    const height = Math.max(rectHeight + indent, avatarSize + indent * 2);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const rectWidth = width - blockPosX;
    const rect = backgroundColorOne === backgroundColorTwo
      ? this.drawRoundRect(backgroundColorOne, rectWidth, height, 25 * scale)
      : this.drawGradientRoundRect(
        backgroundColorOne,
        backgroundColorTwo,
        rectWidth,
        height,
        25 * scale
      );
    ctx.drawImage(rect, blockPosX, 0);
    if (avatar) {
      ctx.drawImage(avatar, avatarPosX, avatarPosY, avatarSize, avatarSize);
    }
    if (name) {
      ctx.drawImage(
        name,
        namePosX,
        namePosY + (nameBarHeight - name.height) / 2
      );
    }
    if (number) {
      let nomorX = blockPosX + indent + (finalContentWidth - number.width - indent * 2);
      ctx.drawImage(
        number,
        nomorX,
        namePosY + (nameBarHeight - name.height) / 2
      );
    }
    if (replyName && (finalReplyTextCanvas || replyMedia)) {
      const replyBg = this.drawRoundRect(
        replyNameColor,
        replyBubbleWidth,
        replyQuotedHeight,
        10 * scale
      );
      ctx.drawImage(replyBg, replyBubblePosX, replyBubblePosY);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(replyBubblePosX + 10 * scale, replyBubblePosY);
      ctx.arcTo(
        replyBubblePosX + replyBubbleWidth, 
        replyBubblePosY, 
        replyBubblePosX + replyBubbleWidth, 
        replyBubblePosY + replyQuotedHeight, 
        10 * scale
      );
      ctx.arcTo(
        replyBubblePosX + replyBubbleWidth, 
        replyBubblePosY + replyQuotedHeight, 
        replyBubblePosX, 
        replyBubblePosY + replyQuotedHeight, 
        10 * scale
      );
      ctx.arcTo(
        replyBubblePosX, 
        replyBubblePosY + replyQuotedHeight, 
        replyBubblePosX, 
        replyBubblePosY, 
        10 * scale
      );
      ctx.arcTo(
        replyBubblePosX, 
        replyBubblePosY, 
        replyBubblePosX + replyBubbleWidth, 
        replyBubblePosY, 
        10 * scale
      );
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = _colorLuminance(backgroundColorOne, 0.09);
      ctx.fillRect(
        replyBubblePosX + 7 * scale,
        replyBubblePosY,
        replyBubbleWidth * scale,
        replyQuotedHeight * scale
      );
      ctx.restore();
      let nameEndsAt = replyBubblePosX + indent;
      if (replyName) {
        const nameX = replyBubblePosX + indent;
        const nameY = replyBubblePosY + (replyNameBarHeight - replyName.height) / 2 + (5 * scale);
        ctx.drawImage(replyName, nameX, nameY);
        nameEndsAt = nameX + replyName.width;
      }
      let mediaStartsAt = replyBubblePosX + replyBubbleWidth - indent;
      if (replyMedia) {
        const mediaX = replyBubblePosX + replyBubbleWidth - quotedThumbW - indent;
        const mediaY = replyBubblePosY + (replyQuotedHeight - quotedThumbH) / 2;
        ctx.drawImage(this.roundImage(replyMedia, 7 * scale), mediaX, mediaY, quotedThumbW, quotedThumbH);
        mediaStartsAt = mediaX;
      }
      if (replyNumber) {
        const leftBoundary = nameEndsAt + gap;
        const rightBoundary = mediaStartsAt - indent * 0.80;
        const numberX = rightBoundary - replyNumber.width;
        if (numberX > leftBoundary) {
          const numberY = replyBubblePosY + (replyNameBarHeight - replyName.height) / 2 + (5 * scale);
          ctx.drawImage(replyNumber, numberX, numberY);
        }
      }
      if (finalReplyTextCanvas) {
        ctx.drawImage(
          finalReplyTextCanvas,
          replyBubblePosX + indent,
          replyBubblePosY + replyNameBarHeight - (15 * scale)
        );
      }
    }
    if (media) {
      ctx.drawImage(
        this.roundImage(media, 8 * scale),
        mediaPosX,
        mediaPosY + 15,
        mediaWidth,
        mediaHeight
      );
    }
    if (text) {
      ctx.drawImage(text, textPosX, textPosY + 10);
    }
    if (fromTime) {
      const timeFontSize = 15 * scale;
      ctx.font = `bold ${timeFontSize}px "Noto Sans"`;
      ctx.fillStyle = "#888";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        fromTime,
        canvas.width - indent * 1.2,
        canvas.height - indent * 0.7
      );
    }
    return canvas;
  }
  async generate(
    backgroundColorOne,
    backgroundColorTwo,
    message,
    width = 512,
    height = 512,
    scale = 2,
    emojiBrand = "apple"
  ) {
    if (!scale) scale = 2;
    if (scale > 20) scale = 20;
    width = width || 512;
    height = height || 512;
    width *= scale;
    height *= scale;
    const backStyle = this.lightOrDark(backgroundColorOne);
    const gap = 15 * scale;
    const nameColorLight = [
      "#FC5C51",
      "#FA790F",
      "#895DD5",
      "#0FB297",
      "#D54FAF",
      "#0FC9D6",
      "#3CA5EC",
    ];
    const nameColorDark = [
      "#FF8E86",
      "#FFA357",
      "#B18FFF",
      "#4DD6BF",
      "#FF7FD5",
      "#45E8D1",
      "#7AC9FF",
    ];
    let nameIndex = 1;
    if (message.from && message.from.id) {
      nameIndex = Math.abs(message.from.id) % 7;
    }
    const nameColorArray =
      backStyle === "light" ? nameColorLight : nameColorDark;
    let nameColor = nameColorArray[nameIndex];
    const colorContrast = new ColorContrast();
    const contrast = colorContrast.getContrastRatio(
      this.colorLuminance(backgroundColorOne, 0.55),
      nameColor
    );
    if (contrast > 90 || contrast < 30) {
      nameColor = colorContrast.adjustContrast(
        this.colorLuminance(backgroundColorTwo, 0.55),
        nameColor
      );
    }
    const nameSize = 28 * scale;
    let textColor = backStyle === "light" ? "#000" : "#fff";
    const indent = 14 * scale;
    let nameText =
      message.from.name ||
      `${message.from.first_name || ""} ${message.from.last_name || ""}`.trim();
    if (!nameText) nameText = "Yanto Baut";
    const nameCanvas = await this.drawMultilineText(
      this.trimNameOrNumber(nameText, 2),
      [{ type: "bold", offset: 0, length: runes(nameText).length }],
      nameSize,
      nameColor,
      0,
      nameSize,
      width,
      nameSize,
      emojiBrand
    );
    let numberCanvas = null;
    if (message.from && message.from.number) {
      const messageNumber = this.formatPhoneNumber(message.from.number)
      numberCanvas = await this.drawMultilineText(
        this.trimNameOrNumber(messageNumber, 2),
        [],
        Math.floor(nameSize * 0.6),
        nameColor,
        0,
        nameSize,
        width,
        nameSize,
        emojiBrand
      );
    }
    let textCanvas;
    if (message.text) {
      textCanvas = await this.drawMultilineText(
        message.text,
        message.entities,
        24 * scale,
        textColor,
        0,
        24 * scale,
        width,
        height,
        emojiBrand
      );
    }
    let avatarCanvas;
    if (message.avatar && message.from) {
      avatarCanvas = await this.drawAvatar(message.from);
    }
    let mediaCanvas;
    if (message.media) {
      mediaCanvas = await this.downloadMediaImage(message.media);
    }
    const mainNameBarWidth =
      (nameCanvas?.width || 0) + (numberCanvas?.width || 0) + indent * 1.5;
    const mainTextWidth = textCanvas?.width || 0;
    const mainMediaWidth = mediaCanvas ? width - indent * 4 : 0;
    const mainContentRequiredWidth = Math.max(
      mainNameBarWidth,
      mainTextWidth,
      mainMediaWidth
    );
    let replyContentRequiredWidth = 0;
    let replyNameCanvas,
      replyNumberCanvas,
      replyTextCanvas_forMeasure,
      replyMedia,
      replyMediaType,
      replyNameColor;
    if (message.replyMessage && message.replyMessage.name && message.replyMessage.text) {
      try {
        const chatId = message.replyMessage.chatId || 0;
        const replyNameIndex = Math.abs(chatId) % 7;
        replyNameColor = nameColorArray[replyNameIndex];
        const replyNameFontSize = 27 * scale;
        replyNameCanvas = await this.drawMultilineText(
          this.trimNameOrNumber(message.replyMessage.name, 2),
          "bold",
          replyNameFontSize,
          replyNameColor,
          0,
          replyNameFontSize,
          width,
          replyNameFontSize,
          emojiBrand
        );
        if (message.replyMessage.number) {
          const replyMessageNumber = this.formatPhoneNumber(message.replyMessage.number)
          replyNumberCanvas = await this.drawMultilineText(
            this.trimNameOrNumber(replyMessageNumber, 2),
            [],
            Math.floor(replyNameFontSize * 0.6),
            replyNameColor,
            0,
            replyNameFontSize,
            width,
            replyNameFontSize,
            emojiBrand
          );
        }
        if (message.replyMessage.text) {
          replyTextCanvas_forMeasure = await this.drawMultilineText(
            message.replyMessage.text,
            message.replyMessage.entities,
            22 * scale,
            textColor,
            0,
            22 * scale,
            width,
            height,
            emojiBrand
          );
        }
        if (message.replyMessage.media) {
          let rawReplyMedia = await this.downloadMediaImage(message.replyMessage.media);
          replyMediaType = message.replyMessage.mediaType;
          if (rawReplyMedia) {
            const targetSize = 60 * scale;
            const tempCanvas = createCanvas(
              rawReplyMedia.width,
              rawReplyMedia.height
            );
            const tempCtx = tempCanvas.getContext("2d");
            tempCtx.drawImage(rawReplyMedia, 0, 0);
            const canvasBuffer = tempCanvas.toBuffer("image/png");
            const resizedBuffer = await sharp(canvasBuffer)
              .resize(targetSize, targetSize, {
                fit: "fill",
                position: "center",
              })
              .png()
              .toBuffer();
            replyMedia = await loadImage(resizedBuffer);
          }
        }
        const replyNameBarWidth = (replyNameCanvas?.width || 0) + (replyNumberCanvas?.width || 0) + indent;
        const replyTextWidth = replyTextCanvas_forMeasure?.width || 0;
        replyContentRequiredWidth = Math.max(replyNameBarWidth, replyTextWidth);
      } catch (error) {
        console.error("Error generating reply message:", error);
        [
          replyNameCanvas,
          replyNumberCanvas,
          replyMedia,
          replyTextCanvas_forMeasure,
          replyNameColor,
        ] = Array(5).fill(null);
      }
    }
    const finalContentWidth = Math.max(mainContentRequiredWidth, replyContentRequiredWidth) + indent * 2;
    if (mediaCanvas && mediaCanvas.width > finalContentWidth - indent * 2) {
      const tempCanvas = createCanvas(mediaCanvas.width, mediaCanvas.height);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(mediaCanvas, 0, 0);
      const buffer = tempCanvas.toBuffer("image/png");
      const resizedBuffer = await sharp(buffer)
        .resize({ width: finalContentWidth - indent * 2 })
        .png()
        .toBuffer();
      mediaCanvas = await loadImage(resizedBuffer);
    }
    let quotedThumbW = 0;
    let quotedThumbH = 0;
    if (replyMedia) {
      quotedThumbW = Math.min(95 * scale, replyMedia.width);
      quotedThumbH = replyMedia.height * (quotedThumbW / replyMedia.width);
    }
    let finalReplyTextCanvas;
    if (replyTextCanvas_forMeasure) {
      const quotedTextMaxWidth = replyMedia ? finalContentWidth - indent * 3 - quotedThumbW : finalContentWidth - indent * 3;
      finalReplyTextCanvas = await this.drawTruncatedText(
        message.replyMessage.text,
        message.replyMessage.entities,
        22 * scale,
        textColor,
        quotedTextMaxWidth,
        emojiBrand
      );
    }
    let finalTextCanvas;
    if (textCanvas) {
      const mainBubbleWidth = finalContentWidth - indent * 2;
      finalTextCanvas = await this.drawMultilineText(
        message.text,
        message.entities,
        24 * scale,
        textColor,
        0,
        24 * scale,
        mainBubbleWidth,
        height,
        emojiBrand
      );
    }
    let fromTime = message.from?.time || null;
    const quote = await this.drawQuote(
      scale,
      backgroundColorOne,
      backgroundColorTwo,
      avatarCanvas,
      replyNameCanvas,
      replyNameColor,
      finalReplyTextCanvas,
      replyNumberCanvas,
      nameCanvas,
      numberCanvas,
      finalTextCanvas,
      mediaCanvas,
      message.mediaType,
      finalContentWidth,
      replyMedia,
      replyMediaType,
      quotedThumbH,
      fromTime,
      emojiBrand,
      gap
    );
    return quote;
  }
}
const imageAlpha = (image, alpha) => {
  const canvas = createCanvas(image.width, image.height);
  const canvasCtx = canvas.getContext("2d");
  canvasCtx.globalAlpha = alpha;
  canvasCtx.drawImage(image, 0, 0);
  return canvas;
};
module.exports = async (parm) => {
  await fontsLoadedPromise;
  if (!parm) {
    return {
      error: "query_empty",
    };
  }
  if (!parm.messages || parm.messages.length < 1) {
    return {
      error: "messages_empty",
    };
  }
  const quoteGenerate = new QuoteGenerate();
  const quoteImages = [];
  let backgroundColor = parm.backgroundColor || "//#292232";
  let backgroundColorOne, backgroundColorTwo;
  const backgroundColorSplit = backgroundColor.split("/");
  if (backgroundColorSplit && backgroundColorSplit.length > 1 && backgroundColorSplit[0] !== "") {
    backgroundColorOne = _normalizeColor(backgroundColorSplit[0]);
    backgroundColorTwo = _normalizeColor(backgroundColorSplit[1]);
  } else if (backgroundColor.startsWith("//")) {
    backgroundColor = _normalizeColor(backgroundColor.replace("//", ""));
    backgroundColorOne = _colorLuminance(backgroundColor, 0.35);
    backgroundColorTwo = _colorLuminance(backgroundColor, -0.15);
  } else {
    backgroundColor = _normalizeColor(backgroundColor);
    backgroundColorOne = backgroundColor;
    backgroundColorTwo = backgroundColor;
  }
  for (const key in parm.messages) {
    const message = parm.messages[key];
    if (message) {
      if (!message.from)
        message.from = {
          id: 0,
        };
      if (message.from.photo) {
        message.avatar = true;
      }
      if (
        !message.from.name &&
        (message.from.first_name || message.from.last_name)
      ) {
        message.from.name = [message.from.first_name, message.from.last_name]
          .filter(Boolean)
          .join(" ");
      }
      if (message.replyMessage) {
        if (!message.replyMessage.chatId)
          message.replyMessage.chatId = message.from?.id || 0;
        if (!message.replyMessage.entities) message.replyMessage.entities = [];
        if (!message.replyMessage.from) {
          message.replyMessage.from = {
            name: message.replyMessage.name,
            photo: {},
          };
        } else if (!message.replyMessage.from.photo) {
          message.replyMessage.from.photo = {};
        }
      }
      const canvasQuote = await quoteGenerate.generate(
        backgroundColorOne,
        backgroundColorTwo,
        message,
        parm.width,
        parm.height,
        parseFloat(parm.scale) || 2,
        parm.emojiBrand || "apple"
      );
      quoteImages.push(canvasQuote);
    }
  }
  if (quoteImages.length === 0) {
    return {
      error: "empty_messages",
    };
  }
  let canvasQuote;
  if (quoteImages.length > 1) {
    let width = 0,
      height = 0;
    for (let index = 0; index < quoteImages.length; index++) {
      if (quoteImages[index].width > width) width = quoteImages[index].width;
      height += quoteImages[index].height;
    }
    const quoteMargin = parm.scale ? 5 * parm.scale : 10;
    const canvas = createCanvas(
      width,
      height + quoteMargin * (quoteImages.length - 1)
    );
    const canvasCtx = canvas.getContext("2d");
    let imageY = 0;
    for (let index = 0; index < quoteImages.length; index++) {
      canvasCtx.drawImage(quoteImages[index], 0, imageY);
      imageY += quoteImages[index].height + quoteMargin;
    }
    canvasQuote = canvas;
  } else {
    canvasQuote = quoteImages[0];
  }
  let quoteImage;
  let { type } = parm;
  const scale = parseFloat(parm.scale) || 2;
  if (!type) {
    type = "quote";
  }
  if (type === "quote") {
    const downPadding = 75;
    const maxWidth = 512;
    const maxHeight = 512;
    const imageQuoteSharp = sharp(canvasQuote.toBuffer());
    if (canvasQuote.height > canvasQuote.width)
      imageQuoteSharp.resize({
        height: maxHeight,
      });
    else
      imageQuoteSharp.resize({
        width: maxWidth,
      });
    const canvasImage = await loadImage(await imageQuoteSharp.toBuffer());
    const canvasPadding = createCanvas(
      canvasImage.width,
      canvasImage.height + downPadding
    );
    const canvasPaddingCtx = canvasPadding.getContext("2d");
    canvasPaddingCtx.drawImage(canvasImage, 0, 0);
    const imageSharp = sharp(canvasPadding.toBuffer());
    if (canvasPadding.height >= canvasPadding.width)
      imageSharp.resize({
        height: maxHeight,
      });
    else
      imageSharp.resize({
        width: maxWidth,
      });
    quoteImage = await imageSharp.png().toBuffer();
  } else if (type === "image") {
    const heightPadding = 75 * scale;
    const widthPadding = 95 * scale;
    const canvasImage = await loadImage(canvasQuote.toBuffer());
    const canvasPic = createCanvas(
      canvasImage.width + widthPadding,
      canvasImage.height + heightPadding
    );
    const canvasPicCtx = canvasPic.getContext("2d");
    const gradient = canvasPicCtx.createRadialGradient(
      canvasPic.width / 2,
      canvasPic.height / 2,
      0,
      canvasPic.width / 2,
      canvasPic.height / 2,
      canvasPic.width / 2
    );
    const patternColorOne = _colorLuminance(backgroundColorTwo, 0.15);
    const patternColorTwo = _colorLuminance(backgroundColorOne, 0.15);
    gradient.addColorStop(0, patternColorOne);
    gradient.addColorStop(1, patternColorTwo);
    canvasPicCtx.fillStyle = gradient;
    canvasPicCtx.fillRect(0, 0, canvasPic.width, canvasPic.height);
    try {
      const canvasPatternImage = await loadImage(
        path.join(__dirname, "../assets/pattern_02.png")
      );
      const pattern = canvasPicCtx.createPattern(
        imageAlpha(canvasPatternImage, 0.3),
        "repeat"
      );
      canvasPicCtx.fillStyle = pattern;
      canvasPicCtx.fillRect(0, 0, canvasPic.width, canvasPic.height);
    } catch (e) {
      console.log("Gagal memuat pattern. Melanjutkan tanpa pattern.");
    }
    canvasPicCtx.shadowOffsetX = 8;
    canvasPicCtx.shadowOffsetY = 8;
    canvasPicCtx.shadowBlur = 13;
    canvasPicCtx.shadowColor = "rgba(0, 0, 0, 0.5)";
    canvasPicCtx.drawImage(canvasImage, widthPadding / 2, heightPadding / 2);
    canvasPicCtx.shadowOffsetX = 0;
    canvasPicCtx.shadowOffsetY = 0;
    canvasPicCtx.shadowBlur = 0;
    canvasPicCtx.shadowColor = "rgba(0, 0, 0, 0)";
    canvasPicCtx.fillStyle = `rgba(0, 0, 0, 0.3)`;
    canvasPicCtx.font = `${8 * scale}px "Noto Sans"`;
    canvasPicCtx.textAlign = "right";
    quoteImage = await sharp(canvasPic.toBuffer())
      .png({
        lossless: true,
        force: true,
      })
      .toBuffer();
  } else if (type === "stories") {
    const canvasPic = createCanvas(720, 1280);
    const canvasPicCtx = canvasPic.getContext("2d");
    const gradient = canvasPicCtx.createRadialGradient(
      canvasPic.width / 2,
      canvasPic.height / 2,
      0,
      canvasPic.width / 2,
      canvasPic.height / 2,
      canvasPic.width / 2
    );
    const patternColorOne = _colorLuminance(backgroundColorTwo, 0.25);
    const patternColorTwo = _colorLuminance(backgroundColorOne, 0.15);
    gradient.addColorStop(0, patternColorOne);
    gradient.addColorStop(1, patternColorTwo);
    canvasPicCtx.fillStyle = gradient;
    canvasPicCtx.fillRect(0, 0, canvasPic.width, canvasPic.height);
    try {
      const canvasPatternImage = await loadImage(
        path.join(__dirname, "../assets/pattern_02.png")
      );
      const pattern = canvasPicCtx.createPattern(
        imageAlpha(canvasPatternImage, 0.3),
        "repeat"
      );
      canvasPicCtx.fillStyle = pattern;
      canvasPicCtx.fillRect(0, 0, canvasPic.width, canvasPic.height);
    } catch (e) {
      console.log("Gagal memuat pattern. Melanjutkan tanpa pattern.");
    }
    canvasPicCtx.shadowOffsetX = 8;
    canvasPicCtx.shadowOffsetY = 8;
    canvasPicCtx.shadowBlur = 13;
    canvasPicCtx.shadowColor = "rgba(0, 0, 0, 0.5)";
    let canvasImage = await loadImage(canvasQuote.toBuffer());
    const minPadding = 110;
    if (
      canvasImage.width > canvasPic.width - minPadding * 2 ||
      canvasImage.height > canvasPic.height - minPadding * 2
    ) {
      canvasImage = await sharp(canvasQuote.toBuffer())
        .resize({
          width: canvasPic.width - minPadding * 2,
          height: canvasPic.height - minPadding * 2,
          fit: "contain",
          background: {
            r: 0,
            g: 0,
            b: 0,
            alpha: 0,
          },
        })
        .toBuffer();
      canvasImage = await loadImage(canvasImage);
    }
    const imageX = (canvasPic.width - canvasImage.width) / 2;
    const imageY = (canvasPic.height - canvasImage.height) / 2;
    canvasPicCtx.drawImage(canvasImage, imageX, imageY);
    canvasPicCtx.shadowOffsetX = 0;
    canvasPicCtx.shadowOffsetY = 0;
    canvasPicCtx.shadowBlur = 0;
    canvasPicCtx.fillStyle = `rgba(0, 0, 0, 0.4)`;
    canvasPicCtx.font = `${16 * scale}px "Noto Sans"`;
    canvasPicCtx.textAlign = "center";
    canvasPicCtx.translate(70, canvasPic.height / 2);
    canvasPicCtx.rotate(-Math.PI / 2);
    quoteImage = await sharp(canvasPic.toBuffer())
      .png({
        lossless: true,
        force: true,
      })
      .toBuffer();
  } else {
    quoteImage = canvasQuote.toBuffer("image/png");
  }
  return { image: quoteImage };
};