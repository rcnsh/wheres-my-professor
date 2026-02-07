# Presage SDK emotion recognition

This app uses **Presage SmartSpectra** to measure physiological vitals from the camera (pulse rate, breathing rate) and infers a simple **emotion** label (stressed / calm / neutral) from those vitals.

## What Presage provides

Presage **SmartSpectra** is a contactless SDK that measures:

- Pulse (heart) rate  
- Breathing rate  
- Heart rate variability (HRV) and other metrics  

It does **not** output emotion directly. We use its vitals and simple heuristics (e.g. elevated pulse/breathing → stressed, low → calm) to derive an emotion label.

## Requirements

- **API key**: Get one at [physiology.presagetech.com](https://physiology.presagetech.com). Enter it in the **Emotion** tab.
- **Android**: The Presage native integration is implemented for **Android only**. Use a **development build** (see below); Expo Go cannot load the native module.
- **iOS**: The **Emotion** tab shows a placeholder; full Presage integration on iOS would require adding the Presage Swift SDK to the module.

## Development build (Android)

The Presage SDK is integrated via a **local Expo module** (`modules/expo-presage-emotion`) that includes native Android code. You must use a **development build**, not Expo Go.

1. **Install dependencies** (from `expo-app`):
   ```bash
   npm install
   ```

2. **Generate native projects**:
   ```bash
   npx expo prebuild
   ```
   This creates the `android` (and `ios`) folders and links the local module.

3. **Run on a device or emulator**:
   ```bash
   npx expo run:android
   ```
   Use a **physical Android device** for camera/vitals; the emulator has no camera.

4. In the app, open the **Emotion** tab, enter your Presage API key, and use the Presage measurement UI to get vitals. The app will show pulse, breathing rate, and the inferred emotion (stressed / calm / neutral).

## Project layout

- **`modules/expo-presage-emotion/`** – Local Expo module:
  - **Android**: Wraps Presage SmartSpectra (`SmartSpectraView` + `SmartSpectraSdk`), forwards vitals to JS via `onVitals` events.
  - **iOS**: Placeholder view only (no Presage SDK).
  - **JS**: `PresageEmotionView` component and `inferEmotionFromVitals(vitals)` for emotion inference.

- **`App.js`** – **Camera** tab (expo-camera) and **Emotion** tab (Presage view + vitals/emotion display).

## Customizing emotion logic

Edit `modules/expo-presage-emotion/src/emotionFromVitals.ts`. Default rules:

- **Stressed**: high pulse (>95 bpm) or high breathing (>22/min).
- **Calm**: low pulse (<55) or low breathing (<10) without high values.
- **Neutral**: otherwise.

You can change thresholds or add more metrics (e.g. HRV from Presage when available) to improve the mapping.
