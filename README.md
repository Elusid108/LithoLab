# LithoLab Web
> A browser-based generator that transforms 2D images into multi-filament, full-color 3D printable lithophanes with integrated AI tooling.

## Overview
LithoLab Web bridges the gap between digital images and physical 3D printing by enabling the creation of full-color, multi-layered lithophanes directly in the browser. It processes 2D images into palette-quantized color layers and grayscale texture depth maps, calculating the precise geometric facets needed for 3D extrusion. By providing an interactive canvas, users can align, mask, and preview their designs before generating the final meshes. The system outputs a comprehensive ZIP archive containing layer-specific STL files (plate, border, colors, texture), preview PNGs, and filament swapping instructions, removing the complexity of manual 3D modeling for color lithophanes.

Lithophane generation is based on [PIXEstL](https://github.com/gaugo87/PIXEstL) by gaugo87.

## Key Features
* **Full-Color Lithophane Generation:** Converts standard 2D photos into precise, multi-layer 3D printable STL files tailored for multi-filament color blending (CMYK+White and beyond).
* **Palette Manager:** Add or remove filaments from a tile-based editor, pick from the bundled Bambu-style filament catalog, create custom colors (hex or HSL with auto-generated layer ramps), and import/export palette JSON. Your active palette is saved in the browser.
* **Palette-Accurate Previews:** Combined Color and Texture preview panes match the PNGs included in the exported ZIP, so what you see is what you print.
* **Vector-Smooth Masks & Borders:** Lithophane pixel reduction applies to photo content only; the mask and white border are composited afterward at fine vector resolution (0.05 mm) so curved edges stay smooth in previews. STL border/plate geometry uses decimated polygon prisms (no pixel stair-steps) with stack-safe mesh emission for reliable ZIP export on complex shapes (e.g. hearts).
* **Separate STL Objects for Slicing:** Exports put all meshes in `stl/` (`layer-plate.stl` under the photo area only, `layer-border.stl` as its own object, plus per-color and texture layers) so you can Select All in the slicer without picking previews or project files. Plate, border, color, and texture layers share a common XY center and sit flat on the build plate (Z=0) when imported as a group.
* **Organized Sidebar Layout:** Settings are grouped into **Color Generation** (palette, plate thickness, pixel width, layer count, mode) and **Texture Generation** (pixel size, min/max thickness) sections for a clearer workflow. **Generate Previews** and **Download STLs** are stacked at the bottom.
* **Border & Export Settings:** Numeric inputs for border **width** (mm), border **height** (mm, Z-thickness of the top ring), **border overlap** (mm, inward shift of the ring to close lithophane gaps without changing printed width), and **pixel size** (mm) for precise control without sliders. Default **color pixel width** is **0.4 mm** for finer color detail.
* **Interactive Editing Workflow:** Upload or AI-generate images, manipulate assets on a canvas with vector mask compositing, generate previews, and export a ready-to-print ZIP archive.
* **AI-Assisted Asset Creation:** Integrates the Google Gemini API directly into the client to generate base images, solid high-contrast mask silhouettes (no interior cutouts), and intelligent asset names. Your API key is stored locally in the browser only — never in source code.

## Technical Architecture
* **Frontend/UI:** TypeScript, Vite, HTML5 Canvas API
* **Backend/Logic:** Client-side processing, Google Gemini API (REST), JSZip
* **Workers:** Palette quantization, STL mesh generation, and ZIP compression run in web workers (with a main-thread fallback) so the progress overlay stays live. Generate Previews caches STL-clip rasters and preview PNGs so Download STLs can skip re-quantizing.
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
The bundled `palette/CMYK-0.10mm.json` includes 15 calibrated filament definitions (with per-layer HSL ramps); only CMY+White are active by default. Use **Manage Palette** in the sidebar to activate additional colors (e.g. Beige, Silver, Purple). Uncalibrated catalog stubs (name-only entries without layer data) are filtered out on load, import, and export. Set **Max colors** to match your AMS slot count, or `0` to use all active filaments at once.

## v2.5.10 changes
* **ZIP folders:** Download STLs now groups files so slicers can import meshes without extra files. `stl/` holds every `.stl`; `previews/` holds the color/texture PNGs; `originals/` holds the source photo, mask, and masked composite. `instructions.txt` and the `.litholab` project stay at the ZIP root.

## v2.5.9 changes
* **Cached STL export:** Generate Previews quantizes once and stores STL-clip rasters plus the preview PNGs drawn to the canvases. Download STLs meshes from that cache (no second quantize pass), so ZIP preview PNGs match the on-screen Color/Texture panes.
* **Download gating:** Download STLs stays disabled until a preview matches the current layout and quantize settings. Changing canvas pose, width/height, border width/overlap, texture pixel size, color pixel width, layer count, pixel mode, color distance, max colors, or the palette requires Generate Previews again. Lithophane name, border height, plate thickness, layer thickness, and min/max texture thickness do not (mesh uses the current values with the cached rasters).
* **No auto-regen:** Border width, overlap, and texture pixel size no longer auto-run Generate Previews.

## v2.5.8 changes
* **Export name field width:** The lithophane name input now stretches to the same width as **Generate Previews** and **Download STLs**.
* **Icon-only AI generate:** Photo and mask AI generate controls are square sparkles buttons to the left of **Choose File** (same height as the file picker). Labels remain on `title` / `aria-label`. The prompt modal Generate button is unchanged.
* **Quantization web worker:** Palette quantization runs in a module worker with row-level progress and a main-thread fallback, so Generate Previews can show “Quantizing colors…” without freezing the UI.
* **STL + ZIP web worker:** Mesh emission (plate, border, color rows, texture) and JSZip compression run in a worker with phase progress (including ZIP percent). Image prep (canvas resize/quantize/PNG) stays on the main thread. Falls back to the main thread if the worker fails to start.

## v2.5.7 changes
* **Border overlap control:** New **Border overlap (mm)** setting (default **0.4 mm**) shifts both inner and outer border ring edges inward by the same amount, closing gaps between lithophane cuboids and the vector border on curved shapes while keeping printed border width unchanged. Applies to preview compositing and `layer-border.stl`. Replaces the hardcoded `pw/2` inner inset from v2.5.5. Plate, lithophane clip, and canvas bounds still use the full mask/silhouette.
* **Inward polygon offset:** `offsetPolygonSet` now supports negative `delta` (erosion) so overlap and other inward geometry operations work correctly.

## v2.5.6 changes
* **Solid-silhouette mask AI prompt:** Mask generation now wraps the user's subject in a detailed prompt that demands a single unbroken white fill with no internal holes, facial details, cutouts, or floating shapes. This reduces AI-generated interior black regions that previously became mask holes during polygon extraction (e.g. nose/eye cutouts inside a bear silhouette). The modal copy now guides users to describe the outer shape only.

## v2.5.5 changes
* **Perimeter cuboid gap fix:** Closed the visible light gap between the lithophane color layers and the border on curved shapes (e.g. circles). Root cause: PIXEstl-era logic in `runColorRow` skipped every pixel with a transparent 4-connected neighbor whenever the image contained any transparency — which is always true after the STL mask stencil. That withheld all mask-boundary color cuboids, leaving color geometry ~1 pixel (`pw`, 0.4 mm default) inside the mask while the vector border inner wall sat on the full mask edge. Fix: emit cuboids for all stencil-kept opaque pixels, including perimeter pixels.
* **Curved-edge border inset:** The border ring's inner loop (`emitRingPrism`) now uses the mask polygon offset inward by `pw/2` (plate still uses the full mask). On smooth curves the vector border can bulge slightly outward between axis-aligned cuboid corners; the inset guarantees the border inner wall overlaps edge cuboid extent without perceptibly changing border width (default 3 mm >> 0.2 mm inset).
* **Updated generation defaults:** Plate thickness 0.15 mm, color layer thickness 0.05 mm, layer count 10, border height 3 mm. Plate thickness is now read from the Color Generation input (`inpPlateThickness`) instead of the unused Texture "First Layer" field.
* **Sidebar cleanup:** Removed unused **First Layer** and **Layer Height** inputs from Texture Generation (they were not wired to the STL pipeline). Plate thickness and layer thickness under Color Generation are the authoritative controls.

## v2.5.4 changes
* **Left/right border gap fix:** Closed the residual sliver gap along the left and right edges between the lithophane cuboids and the border. This was the X analogue of the v2.5.3 Y fix. With the v2.5.2 stencil origin shift (`xOff - pw/2`) in place, each stencil cell center coincides with a cuboid center, so (unlike Y, which has a flip) the mask edge already lands on the cuboid center in X. The leftover `-pw/2` X translate from `flatPrismOpts`/`texturePrismOpts` was knocking the border inner wall off the cuboid centers by half a pixel, letting the outermost cuboids fall short by up to `pw/2` (0.2 mm at the default `pw = 0.4 mm`). The X translate is now `0`, so the border wall sits within the cuboid's X extent and the any-coverage cuboids straddle it on both sides. Border width is unchanged (plate, inner wall, and outer silhouette share the translate). Anti-aliasing was ruled out as a cause: the STL cut is a binary stencil and the plate/border are hard-edged vector geometry; the border inner edge was already derived from the mask polygon.

## v2.5.3 changes
* **Asymmetric Y border gap fix:** The v2.5.2 fix closed the symmetric component of the gap but left a residual ~0.2 mm gap along the **top** edge of the print only. Root cause: `flipPolygonSetY` mirrors polygons around `destImageHeight / 2`, but the cuboid grid in the flipped image is implicitly mirrored around `destImageHeight / 2 - pw/2`, leaving polygon vertices `pw` higher in Y than their matching cuboid centers. The previous `-pw/2` Y translate only closed half of that discrepancy, producing the asymmetric top-edge gap (and a hidden bottom-edge overlap). Two coordinated changes:
  * **Doubled Y translate:** `flatPrismOpts` and `texturePrismOpts` in `src/stl/stlMaker.ts` now translate by `-pw` in Y (X stays at `-pw/2` since there's no X flip), aligning the polygon Y-edge onto the cuboid Y-center on both sides.
  * **Any-coverage STL stencil:** `applyPolygonStencil` in STL mode now retains any pixel touched by the mask (coverage `> 0`) instead of requiring `≥ 50%` coverage. The cuboid grid now extends up to one pixel past the mask edge on every side, guaranteeing it overlaps the border ring's inner wall and eliminating discretization gaps from both axes. The default border width (3 mm) is far larger than `pw` (0.4 mm), so cuboids remain safely inside the silhouette.

## v2.5.2 changes
* **Border alignment fix (proper):** The v2.5.1 translate change did not actually close the gap because it shifted the border and cuboids by equal-and-opposite amounts. The real cause is that the stencil rasterizer in `applyPolygonStencil` was deciding pixel retention against world area `[x*pw, (x+1)*pw]` while the cuboid emitter places that pixel at `[x*pw + xOff - pw/2, x*pw + xOff + pw/2]`. The stencil now uses origin `(xOff - pw/2, yOff - pw/2)` in STL mode (color and texture), so retained pixels map to cuboids whose right edge always overlaps the border ring's inner wall by `(0, pw]` mm — guaranteeing no gap. Border prism translates reverted to the original `(-pw/2, -pw/2, 0)`. Superseded by v2.5.3, which closes the remaining asymmetric Y gap.

## v2.5.1 changes
* **Border alignment fix (incomplete):** Added pixel-grid centering offset to the border prism translation. Superseded by v2.5.2; this change alone did not eliminate the gap.

## v2.5.0 changes
* **Sidebar reorganization:** Settings are now grouped under **Color Generation** and **Texture Generation** sub-sections. Palette is placed at the top of Color Generation for quicker access; texture controls (pixel size, first layer, layer height, min/max thickness) are grouped together below.
* **Editable texture settings:** First Layer, Layer Height, Min Thickness, and Max Thickness are now editable inputs (previously static display values) and wired into the generation pipeline.
* **Label cleanup:** Renamed "White border width" to "Border width" and "LithoLab generation" to "Color Generation".
* **Stack overflow fix:** Replaced recursive palette combination generator with an iterative DFS algorithm using an explicit work stack, eliminating "Maximum call stack size exceeded" crashes when using many active colors with high layer counts.
* **Spread operator elimination:** Replaced all `push(...array)` spread patterns across the palette, CSG, and mesh pipeline with loop-based appending to prevent call-stack pressure from large intermediate arrays.
* **Combination cap:** Added a 200,000-entry safety cap on both the combination search and the Cartesian product across color groups, preventing runaway memory growth on extreme configurations while preserving full output for typical palettes.

## v2.4.4-dev changes
* **STL Z alignment:** Plate now extrudes from Z=0 to Z=plateThickness so the border ring no longer floats above the build plate when all STLs are imported together in Bambu Studio.
* **STL XY alignment:** Color and texture layers are centered within the polygon bounds, eliminating the right/bottom gap between lithophane pixels and the border ring.
* **Palette cleanup:** Removed 35 uncalibrated palette entries that lacked layer data; palette import/export now strips entries without valid HSL ramps.
