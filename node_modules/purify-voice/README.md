# Purify Voice

<div align="center">

🎙️ **Professional audio denoising for JavaScript**

[![npm version](https://img.shields.io/npm/v/purify-voice.svg)](https://www.npmjs.com/package/purify-voice)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Powered by [RNNoise](https://jmvalin.ca/demo/rnnoise/) - Deep learning-based noise suppression

</div>

## ✨ Features

- 🎯 **High-Quality Denoising** - Uses RNNoise deep learning algorithm
- 🚀 **WebAssembly Powered** - Fast, efficient processing
- ⚛️ **Framework Ready** - React hooks, Vue composables, Angular services
- 📦 **Zero Dependencies** - Lightweight and self-contained
- 🌐 **Universal** - Works in browser and Node.js
- 🎨 **TypeScript** - Full type definitions included

## 📦 Installation

```bash
npm install purify-voice
```

Or with yarn:

```bash
yarn add purify-voice
```

## 🚀 Quick Start

### Vanilla JavaScript

```javascript
import { Purify } from 'purify-voice';

// Initialize
const purify = new Purify();
await purify.initialize();

// Process audio file
const audioFile = document.querySelector('input[type="file"]').files[0];
const denoisedBlob = await purify.processFile(audioFile);

// Play or download the result
const audio = new Audio(URL.createObjectURL(denoisedBlob));
audio.play();
```

### React

```jsx
import { usePurify } from 'purify-voice/react';

function AudioDenoiser() {
  const { isReady, processFile, isProcessing } = usePurify();
  const [result, setResult] = useState(null);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    const denoised = await processFile(file);
    setResult(URL.createObjectURL(denoised));
  };

  return (
    <div>
      <input type="file" accept="audio/*" onChange={handleFile} disabled={!isReady} />
      {isProcessing && <p>Processing...</p>}
      {result && <audio src={result} controls />}
    </div>
  );
}
```

### Vue 3

```vue
<template>
  <div>
    <input type="file" accept="audio/*" @change="handleFile" :disabled="!isReady" />
    <p v-if="isProcessing">Processing...</p>
    <audio v-if="result" :src="result" controls />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { usePurify } from 'purify-voice/vue';

const { isReady, processFile, isProcessing } = usePurify();
const result = ref(null);

const handleFile = async (e) => {
  const file = e.target.files[0];
  const denoised = await processFile(file);
  result.value = URL.createObjectURL(denoised);
};
</script>
```

### Angular

```typescript
import { Component } from '@angular/core';
import { PurifyService } from 'purify-voice/angular';

@Component({
  selector: 'app-audio-denoiser',
  template: `
    <input type="file" accept="audio/*" (change)="handleFile($event)" 
           [disabled]="!(purifyService.isReady$ | async)" />
    <p *ngIf="purifyService.isProcessing$ | async">Processing...</p>
    <audio *ngIf="result" [src]="result" controls></audio>
  `
})
export class AudioDenoiserComponent {
  result: string | null = null;

  constructor(public purifyService: PurifyService) {}

  async handleFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    
    this.purifyService.processFile(file).subscribe(denoised => {
      this.result = URL.createObjectURL(denoised);
    });
  }
}
```

### Node.js

```javascript
const { Purify } = require('purify-voice');
const fs = require('fs');

async function denoise() {
  const purify = new Purify();
  await purify.initialize();

  // Read audio file
  const audioBuffer = fs.readFileSync('input.wav');
  const blob = new Blob([audioBuffer]);

  // Process
  const denoised = await purify.processFile(blob);

  // Save result
  const buffer = Buffer.from(await denoised.arrayBuffer());
  fs.writeFileSync('output.wav', buffer);
}

denoise();
```

## 📖 API Reference

### `Purify`

Main class for audio denoising.

#### Constructor

```typescript
new Purify(options?: PurifyOptions)
```

**Options:**
- `sampleRate?: number` - Sample rate (default: 48000)
- `frameSize?: number` - Frame size in samples (default: 480)
- `wasmPath?: string` - Custom WASM file path

#### Methods

##### `initialize(): Promise<void>`

Initialize the Purify instance. Must be called before processing.

##### `processFile(audioFile: File | Blob): Promise<Blob>`

Process an audio file and return denoised audio as a Blob.

##### `processBuffer(audioBuffer: AudioBuffer): Promise<AudioBuffer>`

Process an AudioBuffer and return denoised AudioBuffer.

##### `processStream(inputStream: MediaStream): Promise<MediaStream>`

Process a real-time audio stream (e.g., from microphone).

##### `processRaw(pcmData: Float32Array): Promise<Float32Array>`

Process raw PCM data.

##### `isReady(): boolean`

Check if Purify is initialized and ready.

##### `destroy(): void`

Clean up resources.

### React Hook: `usePurify`

```typescript
const {
  isReady,      // boolean - Is Purify initialized?
  isProcessing, // boolean - Is currently processing?
  error,        // Error | null - Last error
  processFile,  // (file: File) => Promise<Blob | null>
  processBuffer,// (buffer: AudioBuffer) => Promise<AudioBuffer | null>
  processStream // (stream: MediaStream) => Promise<MediaStream | null>
} = usePurify(options?);
```

### Vue Composable: `usePurify`

```typescript
const {
  isReady,      // Ref<boolean>
  isProcessing, // Ref<boolean>
  error,        // Ref<Error | null>
  processFile,  // (file: File) => Promise<Blob | null>
  processBuffer,// (buffer: AudioBuffer) => Promise<AudioBuffer | null>
  processStream // (stream: MediaStream) => Promise<MediaStream | null>
} = usePurify(options?);
```

## 🎯 Use Cases

- **Voice Calls** - Remove background noise from video/audio calls
- **Podcasts** - Clean up podcast recordings
- **Voice Notes** - Enhance voice message quality
- **Transcription** - Improve speech-to-text accuracy
- **Music Production** - Remove unwanted noise from recordings

## 🌐 Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Node.js 14+

## 📊 Performance

- **Processing Speed**: ~100x real-time (10ms audio processed in ~0.1ms)
- **Latency**: <10ms for real-time processing
- **Memory**: ~5MB WASM module + processing buffers
- **Package Size**: ~200-500KB (gzipped)

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

## 📝 License

MIT © Sagar

## 🙏 Credits

- Built on [RNNoise](https://jmvalin.ca/demo/rnnoise/) by Jean-Marc Valin
- Powered by WebAssembly

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📮 Support

- 🐛 [Report a bug](https://github.com/sagar32/purify-voice/issues)
- 💡 [Request a feature](https://github.com/sagar32/purify-voice/issues)
- 📖 [Documentation](https://github.com/sagar32/purify-voice#readme)

---

<div align="center">

Made with ❤️ by Sagar

</div>
