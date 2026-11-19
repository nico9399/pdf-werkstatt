# PDF Werkstatt

Private PDF-Werkzeuge fürs iPhone: komprimieren, zusammenfügen, Seiten bearbeiten, aufteilen, Scannen, Fotos → PDF, Extras (Seitenzahlen, Wasserzeichen, Passwort) und Umwandeln (Bilder, Text, Word).

Alles läuft lokal im Browser. Dateien werden nicht hochgeladen.

## Verwendete Bausteine
- [Ghostscript](https://ghostscript.com/) 9.56 als WebAssembly über [@jspawn/ghostscript-wasm](https://www.npmjs.com/package/@jspawn/ghostscript-wasm) – AGPL-3.0, unverändert. Quellcode: https://github.com/ArtifexSoftware/ghostpdl
- [pdf-lib](https://pdf-lib.js.org/) – MIT
- [PDF.js](https://mozilla.github.io/pdf.js/) – Apache-2.0
- [OpenCV.js](https://opencv.org/) über [@techstark/opencv-js](https://www.npmjs.com/package/@techstark/opencv-js) – Apache-2.0 (Scanner: Rand-Erkennung, Entzerren)
- [JSZip](https://stuk.github.io/jszip/) – MIT
- [SortableJS](https://sortablejs.github.io/Sortable/) – MIT
- Schrift [Archivo](https://fonts.google.com/specimen/Archivo) – SIL Open Font License
