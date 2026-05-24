# LithoLab Web
> A browser-based generator that transforms 2D images into multi-filament, full-color 3D printable lithophanes with integrated AI tooling.

> **Development release (v2.4.2-dev):** This version is **not stable**. Preview, mask, and STL export behavior may change. Use the [v2.3.0 release](https://github.com/Elusid108/LithoLab/releases) on GitHub if you need the last stable build.

## Overview
LithoLab Web bridges the gap between digital images and physical 3D printing by enabling the creation of full-color, multi-layered lithophanes directly in the browser. It processes 2D images into palette-quantized color layers and grayscale texture depth maps, calculating the precise geometric facets needed for 3D extrusion. By providing an interactive canvas, users can align, mask, and preview their designs before generating the final meshes. The system outputs a comprehensive ZIP archive containing layer-specific STL files (plate, border, colors, texture), preview PNGs, and filament swapping instructions, removing the complexity of manual 3D modeling for color lithophanes.

Lithophane generation is based on [PIXEstL](https://github.com/gaugo87/PIXEstL) by gaugo87.

## Key Features
* **Full-Color Lithophane Generation:** Converts standard 2D photos into precise, multi-layer 3D printable STL files tailored for multi-filament color blending (CMYK+White and beyond).
* **Palette Manager:** Add or remove filaments from a tile-based editor, pick from the bundled Bambu-style filament catalog, create custom colors (hex or HSL with auto-generated layer ramps), and import/export palette JSON. Your active palette is saved in the browser.
* **Palette-Accurate Previews:** Combined Color and Texture preview panes match the PNGs included in the exported ZIP, so what you see is what you print.
* **Vector-Smooth Masks & Borders:** Lithophane pixel reduction applies to photo content only; the mask and white border are composited afterward at fine vector resolution (0.05 mm) so curved edges stay smooth in previews. STL border/plate geometry uses decimated polygon prisms (no pixel stair-steps) with stack-safe mesh emission for reliable ZIP export on complex shapes (e.g. hearts).
* **Separate STL Objects for Slicing:** Exports include `layer-plate.stl` (support under the photo area only), `layer-border.stl` (white border ring as its own object for a different filament/color), plus per-color and texture layers — so Bambu Studio and similar slicers can assign materials independently.
* **Border & Export Settings:** Numeric inputs for white border **width** (mm), border **height** (mm, Z-thickness of the top ring), and **pixel size** (mm) for precise control without sliders.
* **Interactive Editing Workflow:** Upload or AI-generate images, manipulate assets on a canvas with vector mask compositing, generate previews, and export a ready-to-print ZIP archive.
* **AI-Assisted Asset Creation:** Integrates the Google Gemini API directly into the client to generate base images, high-contrast stencils, and intelligent asset names. Your API key is stored locally in the browser only — never in source code.

## Technical Architecture
* **Frontend/UI:** TypeScript, Vite, HTML5 Canvas API
* **Backend/Logic:** Client-side processing, Google Gemini API (REST), JSZip
* **Mesh Generation:** Custom CSG/STL pipeline (PIXEstL-aligned palette engine, polygon-prism edge geometry)
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
