# LithoLab Web
> A browser-based generator that transforms 2D images into multi-filament, full-color 3D printable lithophanes with integrated AI tooling.

## Overview
LithoLab Web bridges the gap between digital images and physical 3D printing by enabling the creation of full-color, multi-layered lithophanes directly in the browser. It processes 2D images into separated CMYK and white depth maps, calculating the precise geometric facets needed for 3D extrusion based on color density. By providing an interactive canvas, users can align, mask, and preview their designs before generating the final meshes. The system outputs a comprehensive ZIP archive containing layer-specific STL files and filament swapping instructions, removing the complexity of manual 3D modeling for color lithophanes.

## Key Features
* **Full-Color Lithophane Generation:** Converts standard 2D photos into precise, multi-layer 3D printable STL files tailored for CMYK filament blending.
* **Interactive Editing Workflow:** Users navigate through image upload or AI generation, manipulate assets on a canvas with smart masking, preview CMYK separations, and export a ready-to-print ZIP archive.
* **AI-Assisted Asset Creation:** Integrates the Google Gemini API directly into the client to generate base images, high-contrast stencils, and intelligent asset names on the fly.

## Technical Architecture
* **Frontend/UI:** TypeScript, Vite, HTML5 Canvas API
* **Backend/Logic:** Client-side processing, Google Gemini API (REST), JSZip
* **Infrastructure/Hardware:** Static Web Hosting, `@jscad/modeling` (for client-side mesh generation)

## Setup & Deployment
1. Clone the repository and navigate to the project directory.
2. Install project dependencies by running `npm install`.
3. Start the local Vite development server using `npm run dev`.
4. Build the application for production deployment with `npm run build`.