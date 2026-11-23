# Herramientas PDF

Herramientas PDF gratuitas que funcionan por completo en el navegador: los archivos nunca se suben a un servidor.

- **Aplicación:** `index.html` · **Ayuda:** `ayuda.html`

| Herramienta | Qué hace |
|---|---|
| Unir PDF | Combina varios PDF en el orden elegido |
| Organizar páginas | Reordena (arrastrando), rota y elimina páginas |
| Dividir y extraer | Extrae rangos, separa por página o cada N páginas (ZIP) |
| Comprimir PDF | Optimización sin pérdida o compresión por imagen (150/110/80 ppp) |
| Imágenes a PDF | JPG, PNG, WebP → PDF (A4, Carta o tamaño de la imagen) |
| PDF a imágenes | Páginas → JPG o PNG (96/150/300 ppp) |
| Numerar páginas | Posición, formato, número inicial, omitir portada |
| Marca de agua | Texto con tamaño, color, dirección y transparencia |
| Firmar PDF | Firma dibujada, escrita o desde imagen, colocada con un clic |

## Publicar en GitHub Pages

*Settings › Pages › Deploy from a branch*, rama `main`, carpeta `/ (root)`.

La aplicación usa módulos de JavaScript, así que debe abrirse desde una dirección web (GitHub Pages o un servidor local como `python -m http.server`), no con doble clic sobre `index.html`.

## Bibliotecas

[pdf-lib](https://pdf-lib.js.org/) (MIT), [PDF.js](https://mozilla.github.io/pdf.js/) (Apache 2.0) y [JSZip](https://stuk.github.io/jszip/) (MIT), incluidas en `lib/`.
