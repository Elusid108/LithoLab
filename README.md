# LithoLab Web
> A browser-based generator that transforms 2D images into multi-filament, full-color 3D printable lithophanes with integrated AI tooling.

## Overview
LithoLab Web bridges the gap between digital images and physical 3D printing by enabling the creation of full-color, multi-layered lithophanes directly in the browser. It processes 2D images into separated CMYK and white depth maps, calculating the precise geometric facets needed for 3D extrusion based on color density. By providing an interactive canvas, users can align, mask, and preview their designs before generating the final meshes. The system outputs a comprehensive ZIP archive containing layer-specific STL files and filament swapping instructions, removing the complexity of manual 3D modeling for color lithophanes.

Lithophane generation is based on [PIXEstL](https://github.com/gaugo87/PIXEstL) by gaugo87.

## Key Features
* **Full-Color Lithophane Generation:** Converts standard 2D photos into precise, multi-layer 3D printable STL files tailored for multi-filament color blending (CMYK+White and beyond).
* **Palette Manager:** Add or remove filaments from a tile-based editor, pick from the bundled Bambu-style filament catalog, create custom colors (hex or HSL with auto-generated layer ramps), and import/export palette JSON. Your active palette is saved in the browser.
* **Interactive Editing Workflow:** Upload or AI-generate images, manipulate assets on a canvas with smart masking, preview CMYK separations, and export a ready-to-print ZIP archive.
* **AI-Assisted Asset Creation:** Integrates the Google Gemini API directly into the client to generate base images, high-contrast stencils, and intelligent asset names. Your API key is stored locally in the browser only — never in source code.

## Technical Architecture
* **Frontend/UI:** TypeScript, Vite, HTML5 Canvas API
* **Backend/Logic:** Client-side processing, Google Gemini API (REST), JSZip
* **Mesh Generation:** Custom CSG/STL pipeline (PIXEstL-aligned palette engine)
* **Infrastructure:** Static web hosting via GitHub Pages

## Setup & Deployment

### Quick start (Windows)
Double-click `launch.bat` in the project root. It installs dependencies on first run, starts the Vite dev server, and opens the app at `http://localhost:5173/LithoLab/`.

### Manual setup
1. Clone the repository and navigate to the project directory.
2. Install project dependencies: `npm install`
3. Start the local dev server: `npm run dev`
4. Build for production: `npm run build`

### GitHub Pages
Pushes to `main` automatically deploy to GitHub Pages. The site is served at `/LithoLab/` (configured in `vite.config.ts`).

## Palette tips
The bundled `palette/CMYK-0.10mm.json` includes ~50 filament definitions; only CMY+White are active by default. Use **Manage Palette** in the sidebar to activate additional colors (e.g. Beige, Brown, Pink for skin tones). Set **Max colors** to match your AMS slot count, or `0` to use all active filaments at once.
