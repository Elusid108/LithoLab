# LithoLab

Web app to prepare a full-color photo (and optional mask), preview CMYK-style separation channels, and export a ZIP of STLs using a [PIXEstL](https://github.com/gaugo87/PIXEstL)-style generation pipeline. Lithophane generation is based on PIXEstL by gaugo87.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer (matches the GitHub Actions workflow)

## Quick start

```bash
npm ci    # or: npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

Other scripts:

- `npm run build` — TypeScript check (`tsc`) and production bundle to `dist/`
- `npm run preview` — Serve the production build locally

## Core workflow

1. Upload a **Photo (color)** image. An optional **Mask** (shape) image can be uploaded or generated later.
2. Use **Edit Photo** / **Edit Mask** to choose which layer the canvas handles affect.
3. Arrange and scale the layers on the canvas (see below).
4. Click **GENERATE PREVIEWS** to rasterize the composite and build channel previews.
5. When previews exist, **Download STLs** exports a ZIP of generated models.

## Canvas controls

The active layer shows a green outline and handles:

| Interaction | Behavior |
|-------------|----------|
| Drag **inside** the layer | Move |
| **Corner** handles | Proportional resize (aspect ratio preserved), anchored to the layer center at drag start |
| **Edge midpoint** handles (top, bottom, left, right) | **Independent** width or height scaling (“warping”) along the layer’s local axes after rotation; minimum size 10 px |
| **Top** handle (circle on the stalk above the box) | Rotate around the layer center |

## Mask

- The mask is optional. If present, it defines where the lithophane is visible (composite uses destination-in with the mask).
- Uploaded mask images are converted to a high-contrast alpha stencil (bright regions become opaque).
- If you load a photo before a mask, export dimensions can follow the photo’s aspect; loading a mask first ties export height to the mask aspect.

## AI features (optional)

Requires a Google AI Studio API key in **Settings** (stored in the browser). With a valid key:

- **Refresh Models** loads available Gemini **text** models and **image** models; selections are persisted.
- **Generate with AI** / **Generate Mask AI** opens a prompt modal (image generation uses the selected image model).
- **Auto Name** next to the lithophane name uses the selected text model to suggest a filename from the photo.
- AI-generated assets can receive **automatic** short slugs from vision/text models.
- **History** strips under each upload card keep the last **five** generated images for quick recall.

## Palette

- A default CMYK-oriented palette ships as JSON under `palette/` (for example `palette/CMYK-0.10mm.json`).
- You can load a replacement palette JSON file; the UI shows active color swatches and a count.

## Lithophane and export settings

- **Lithophane name** — Used for the ZIP download filename (sanitized).
- **White border width** — Extra mm around the masked content (when a mask is used, distance-based expansion is applied during generation).
- **Pixel size (mm)** — Physical size per texture pixel; the UI shows an **export grid** size (pixel dimensions) derived from the physical width/height.
- **Width / height** — Physical **export** size in mm or inches (unit toggle).
- The sidebar also shows a **static summary** of default layer thickness hints (first layer, layer height, min/max thickness). The values that go into the ZIP pipeline are the inputs under **LithoLab generation**:
  - Plate thickness (mm)
  - Color pixel width (mm)
  - Layer thickness (mm)
  - Layer count
  - Mode: **ADDITIVE** or **FULL**
  - Color distance: **CIELab** or **RGB**
  - Max colors (`0` = no limit)

## Outputs

After **GENERATE PREVIEWS**:

- **Composite preview** (with border) and per-channel canvases **Cyan**, **Magenta**, **Yellow**, and **White** (thickness / base).
- **Download STLs** produces a ZIP built from the composite and current palette plus generation instructions.

## Deployment

Pushes to `main` run [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): `npm ci`, `npm run build`, then upload `dist/` to **GitHub Pages**.

## License

See [LICENSE](LICENSE). Third-party credits include [PIXEstL](https://github.com/gaugo87/PIXEstL) as linked above.
