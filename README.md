<h1 align="center">qc-generator-whatsapp</h1>

[![NPM Version](https://img.shields.io/npm/v/qc-generator-whatsapp.svg)](https://www.npmjs.com/package/qc-generator-whatsapp)
[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://github.com/Terror-Machine/qc-generator-whatsapp/blob/master/LICENSE)

Library Node.js untuk membuat gambar dari struktur data pesan chat dan berbagai generator teks visual.

## 📦 Dependensi Utama

Library ini menggunakan dua dependensi utama yang perlu diperhatikan:

1. **Canvas** - Untuk rendering gambar dan teks
   - Memerlukan instalasi native dependencies (Cairo, Pango, dll)
   - Pada sistem Linux, install dependencies terlebih dahulu:
     ```bash
     # Debian/Ubuntu
     sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev

     # Fedora
     sudo dnf install gcc-c++ cairo-devel pango-devel libjpeg-turbo-devel giflib-devel librsvg2-devel
     ```

2. **FFmpeg** - Untuk pembuatan animasi video
   - `fluent-ffmpeg` hanyalah wrapper Node.js dan membutuhkan FFmpeg terinstall di sistem
   - Harus terinstall secara global di sistem Anda:
     ```bash
     # Ubuntu/Debian
     sudo apt-get update && sudo apt-get install ffmpeg -y

     # MacOS
     brew install ffmpeg

     # Windows (via Chocolatey)
     choco install ffmpeg
     ```

## ⚠️ Persyaratan Sistem

Pastikan sistem Anda memenuhi persyaratan berikut sebelum menggunakan library ini:

1. **Node.js** v14 atau lebih baru
2. **Python** 2.7 atau 3.x (diperlukan untuk kompilasi Canvas)
3. **Build tools** (seperti GCC, make)
4. **FFmpeg** versi 4.0 atau lebih baru (wajib untuk fitur animasi)

## 🛠️ Troubleshooting Instalasi

Jika mengalami masalah saat instalasi:

**Masalah Canvas:**
```bash
# Jika gagal install canvas, coba:
npm install canvas --build-from-source
```

**Verifikasi FFmpeg:**
```bash
ffmpeg -version
# Harus menampilkan versi FFmpeg tanpa error
```

**Jika FFmpeg tidak terdeteksi:**
1. Pastikan FFmpeg terinstall di sistem
2. Atau tentukan path manual:
   ```javascript
   const ffmpeg = require('fluent-ffmpeg');
   ffmpeg.setFfmpegPath('/path/to/ffmpeg');
   ```

**Error kompilasi:**
- Pastikan semua dependencies native terinstall
- Pada Windows, install Windows Build Tools:
  ```bash
  npm install --global windows-build-tools
  ```


## ✨ Fitur Utama

- Generator gambar chat WhatsApp dengan balasan, media, dan format teks kaya
- Generator teks dengan highlight kata kunci
- Generator animasi teks progresif
- Dukungan emoji lintas platform
- Render avatar dinamis
- Kustomisasi warna dan layout

## ⚙️ Instalasi

```bash
npm install qc-generator-whatsapp
```

## 🚀 Contoh Penggunaan

### 1. Generator Chat WhatsApp

Berikut adalah contoh lengkap cara mengimpor library, menyiapkan data, dan menyimpan gambar yang dihasilkan.

```javascript
const fs = require('fs/promises');
const QuoteGenerator = require('qc-generator-whatsapp');

// Fungsi utama untuk menjalankan generator
async function main() {
  console.log('Membuat gambar chat...');

  // Muat gambar avatar dan media ke dalam Buffer terlebih dahulu.
  // Ini adalah cara yang benar untuk menyediakan gambar eksternal ke library.
  const avatarBuffer = await fs.readFile('./src/media/apatar.png');
  const mediaBuffer = await fs.readFile('./src/media/susu.jpg');

  const params = {
    type: 'image', // Tipe output: 'image', 'stories', atau 'quote'
    backgroundColor: '#1b2226',
    width: 512,
    scale: 2,
    messages: [
      {
        avatar: true,
        from: {
          id: 2,
          name: 'Mukidi Slamet Sentosa',
          photo: {}, // Sengaja di kosongkan agar ada callback Initial
          number: '+6212345678909',
          time: "11:21"
        },
        text: 'Ini adalah contoh pesan dengan teks tebal, teks miring, dan monospace. Juga ada emoji! 😄',
        entities: [
            { type: 'bold', offset: 31, length: 10 },
            { type: 'italic', offset: 43, length: 11 },
            { type: 'monospace', offset: 60, length: 9 }
        ],
        replyMessage: {
          chatId: 1,
          name: 'Denis Dontol',
          text: '😄 Ini adalah contoh pesan yang dibalas.',
          number: '+6234567890123'
        },
        media: {
          // Berikan gambar media sebagai Buffer
          buffer: "./src/media/susu.jpg",
        },
      },
      {
        avatar: true,
        from: {
          id: 3,
          name: 'Upin Ipin Botak!',
          photo: {
            buffer: avatarBuffer,
          },
          number: '+6212345678909',
          time: "11:23"
        },
        text: 'Ini adalah contoh pesan kedua untuk membalas pesan media dari pesan pertama!',
        replyMessage: {
          chatId: 2,
          name: 'Mukidi Slamet Sentosa',
          text: 'Ini adalah contoh pesan dengan teks tebal, teks miring, dan monospace. Juga ada emoji! 😄',
          number: '+6212345678909',
          entities: [
              { type: 'bold', offset: 31, length: 10 },
              { type: 'italic', offset: 43, length: 11 },
              { type: 'monospace', offset: 60, length: 9 }
          ],
          media: {
            buffer: mediaBuffer,
          },
        },
      },
    ],
  };

  try {
    const result = await QuoteGenerator(params);

    // Simpan gambar hasil ke file
    await fs.writeFile('hasil-chat.png', result.image);
    console.log('Gambar berhasil dibuat: hasil-chat.png');

  } catch (error) {
    console.error('Gagal membuat gambar:', error);
  }
}

main();
```

### 2. Generator Teks dengan Highlight (bratGenerator)

```javascript
const { bratGenerator } = require('qc-generator-whatsapp');
const fs = require('fs/promises');

async function generateHighlightedText() {
  try {
    const text = "Ini adalah contoh teks dengan kata-kata penting yang perlu dihighlight";
    const highlightWords = ["contoh", "penting", "highlight"];
    
    const imageBuffer = await bratGenerator(text, highlightWords);
    await fs.writeFile('highlighted.png', imageBuffer);
    console.log('Gambar teks berhasil dibuat!');
  } catch (error) {
    console.error('Gagal membuat gambar:', error);
  }
}

generateHighlightedText();
```

### 3. Generator Animasi Teks (bratVidGenerator)

```javascript
const { bratVidGenerator, generateAnimatedBratVid } = require('qc-generator-whatsapp');
const fs = require('fs/promises');
const path = require('path');

async function generateTextAnimation() {
  try {
    // Buat frame-frame animasi
    const frames = await bratVidGenerator(
      "Animasi teks muncul satu per satu ✨",
      512, 
      512,
      "#FFFFFF",
      "#FF5733"
    );

    // Simpan frame sementara
    const tempDir = './temp_frames';
    await fs.mkdir(tempDir, { recursive: true });
    
    for (let i = 0; i < frames.length; i++) {
      await fs.writeFile(path.join(tempDir, `frame_${i+1}.png`), frames[i]);
    }

    // Gabungkan frame menjadi video
    await generateAnimatedBratVid(tempDir, 'animation.webp');
    console.log('Animasi berhasil dibuat!');

    // Bersihkan frame sementara
    await fs.rm(tempDir, { recursive: true });
  } catch (error) {
    console.error('Gagal membuat animasi:', error);
  }
}

generateTextAnimation();
```

## 📚 Dokumentasi API Lengkap

### 1. Fungsi Utama

#### `generate(params)`

Fungsi utama yang diekspor. Ini adalah fungsi `async` yang mengembalikan `Promise`.

  - `params` (Object): Objek konfigurasi untuk gambar yang akan dibuat.

#### Struktur Objek `params`

  - `type` (String): Tipe output. Pilihan: `'image'`, `'stories'`, `'quote'`. Default: `'quote'`.
  - `backgroundColor` (String): Warna latar belakang. Bisa hex (`#FFFFFF`), warna solid, atau gradien (`#FFFFFF/#000000`).
  - `width` (Number): Lebar dasar kanvas. Default: `512`.
  - `height` (Number): Tinggi dasar kanvas. Default: `512`.
  - `scale` (Number): Faktor pembesaran untuk menghasilkan gambar berkualitas lebih tinggi. Default: `2`, Max: `20`.
  - `messages` (Array): Array berisi satu atau lebih objek pesan yang akan dirender.

#### Struktur Objek `message` (di dalam array `messages`)

  - `avatar` (Boolean): Jika `true`, akan mencoba merender avatar.
  - `text` (String): Teks utama dari pesan.
  - `entities` (Array): Array objek yang mendefinisikan format teks.
      - `type` (String): Jenis format (`bold`, `italic`, `code`, `mention`).
      - `offset` (Number): Posisi awal karakter.
      - `length` (Number): Panjang karakter yang diformat.
  - `from` (Object): Informasi pengirim pesan.
      - `id` (Number): ID unik pengguna (digunakan untuk warna nama dan fallback avatar).
      - `name` (String): Nama pengirim yang akan ditampilkan.
      - `photo` (Object): Sumber gambar untuk avatar.
          - `buffer` (Buffer): **(Wajib untuk file eksternal)** Buffer dari gambar avatar.
          - `path` (String): **Peringatan:** Opsi ini hanya berfungsi untuk file internal paket dan tidak bisa digunakan untuk memuat file dari komputer pengguna.
      - `number` (String): Nomor pengirim yang akan ditampilkan.
      - `time` (String): Waktu yang akan ditampilkan.
  - `media` (Object): Gambar yang dilampirkan pada pesan.
      - `buffer` (Buffer): **(Wajib untuk file eksternal)** Buffer dari gambar media.
      - `path` (String): **Peringatan:** Sama seperti `photo.path`, ini tidak bisa digunakan untuk file eksternal.
  - `replyMessage` (Object): Pesan yang dibalas (memiliki struktur yang mirip dengan `message`).
      - `chatId` (Number): ID unik pengguna (digunakan untuk warna nama).
      - `name` (String): Nama pengirim dari pesan yang dibalas.
      - `text` (String): Teks dari pesan yang dibalas.
      - `number` (String): Nomor pengirim yang akan ditampilkan.
      - `entities` (Array): Array objek yang mendefinisikan format teks.
          - `type` (String): Jenis format (`bold`, `italic`, `code`, `mention`).
          - `offset` (Number): Posisi awal karakter.
          - `length` (Number): Panjang karakter yang diformat.
      - `media` (Object): Gambar yang dilampirkan pada pesan.
          - `buffer` (Buffer): **(Wajib untuk file eksternal)** Buffer dari gambar media.
          - `path` (String): **Peringatan:** Sama seperti `photo.path`, ini tidak bisa digunakan untuk file eksternal.

#### Nilai Kembalian (Return Value)

Fungsi `generate` mengembalikan sebuah `Promise` yang akan resolve menjadi sebuah Objek:

  - `image` (Buffer): Buffer dari gambar PNG yang telah dibuat.
  - `warnings` (Array): (Opsional) Sebuah array berisi pesan peringatan jika terjadi masalah non-fatal selama proses pembuatan gambar.

### 2. Fungsi Lain

1. **`bratGenerator(text, highlightWords)`** 
   - `text`: String teks yang akan dirender
   - `highlightWords`: Array kata-kata yang akan dihighlight

2. **`bratVidGenerator(text, width, height, bgColor, textColor)`**
   - Membuat frame-frame animasi teks
   - Mengembalikan array buffer gambar PNG

3. **`generateAnimatedBratVid(frameDir, outputPath)`**
   - Menggabungkan frame menjadi animasi WebP
   - `frameDir`: Direktori berisi frame (format: frame_1.png, frame_2.png, ...)
   - `outputPath`: Path output file animasi

### 3. Fungsi Pendukung

- **`randomChoice(arr)`** - Memilih elemen random dari array

## 🛠️ Error Handling

Semua fungsi mengembalikan Promise dengan error handling internal. Selalu gunakan `try/catch` saat memanggil fungsi async.

## 📄 Lisensi

GPL v3 - [Lihat lengkap](https://github.com/Terror-Machine/qc-generator-whatsapp/blob/master/LICENSE)

## 🙏 Ucapan Terima Kasih

Fungsi utama kode ini adalah hasil modifikasi dari repositori [quote-api oleh LyoSU](https://github.com/LyoSU/quote-api). 

Terima kasih untuk [@LyoSU](https://github.com/LyoSU) dan semua kontributor di repositori tersebut.

## 🌟 Contoh Output

![Contoh QuoteGenerator](https://github.com/Terror-Machine/qc-generator-whatsapp/blob/master/example2.png)
![Contoh bratGenerate](https://github.com/Terror-Machine/qc-generator-whatsapp/blob/master/example1.png)
![Contoh Video BratGenerate](https://github.com/Terror-Machine/qc-generator-whatsapp/blob/master/example.mp4)