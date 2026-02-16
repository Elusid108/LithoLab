# LithoLab

Browser-based CMYK lithophane designer: upload a photo and optional mask, edit on a canvas, set dimensions and pixel size, then export a ZIP of STL files for multi-color printing. Export is powered by the [PIXEstL](https://github.com/gaugo87/PIXEstL) Java engine via a local backend.

## Export via PIXEstL

STL export uses the Java PIXEstL engine (small, optimized ZIPs) instead of in-browser mesh generation. You need:

1. **Java** installed and on your `PATH` (or `JAVA_HOME` set).
2. **PIXEstL** built once. PIXEstL is included inside LithoLab. From the LithoLab repo root:
   ```bash
   cd PIXEstL
   mvn clean install
   ```
   This produces `PIXEstL/target/PIXEstL.jar` (or `PIXEstL-*.jar`).
3. **Start the LithoLab backend** from the LithoLab directory:
   ```bash
   npm install
   node server.js
   ```
   Or: `npm start`. The server listens on `http://localhost:3000`.
4. **Open LithoLab** in your browser (e.g. open `index.html` or use a local static server). Click **GENERATE PREVIEWS**, then **Download STL ZIP**. The app sends the composite image and dimensions to the backend; the backend runs PIXEstL and returns the ZIP.

### Backend configuration

- **JAR path:** By default the backend looks for the JAR in `PIXEstL/target/PIXEstL.jar` or `PIXEstL-*.jar`. Override with env: `PIXESTL_JAR=/path/to/PIXEstL.jar`.
- **Palette:** By default it uses `PIXEstL/src/main/resources/palette-cmyw-0.10mm.json`. Override with: `PIXESTL_PALETTE=/path/to/palette.json`.
- **Port:** `PORT=3000` (default). Change if needed; then set `EXPORT_BACKEND_URL` in `script.js` to match (e.g. `http://localhost:4000`).

## Running the app

Open `index.html` in a browser, or serve the folder with any static server (e.g. `npx serve .`). For export to work, the backend must be running as above.

## Credits

Lithophane generation is based on [PIXEstL](https://github.com/gaugo87/PIXEstL) by gaugo87. See [NOTICE](NOTICE) for license details.
