/* =========================================================
   Herramientas PDF — todo se procesa en el navegador
   pdf-lib (edición) + PDF.js (vista previa y conversión a imagen)
   ========================================================= */
import * as pdfjsLib from '../lib/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.min.mjs', import.meta.url).href;
const OPC_PDFJS = {
  cMapUrl: new URL('../lib/cmaps/', import.meta.url).href, cMapPacked: true,
  standardFontDataUrl: new URL('../lib/standard_fonts/', import.meta.url).href
};
const { PDFDocument, degrees, rgb, StandardFonts } = window.PDFLib;

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vista = $('#vista');
function toast(msg, error) {
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), error ? 5500 : 3000);
}
function cargando(si, txt) { $('#cargando').hidden = !si; if (txt) $('#cargaTxt').textContent = txt; }
const espera = () => new Promise(r => setTimeout(r, 0));
function fmtTam(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
const base = n => n.replace(/\.[^.]+$/, '');
function descargar(datos, nombre, tipo = 'application/pdf') {
  const blob = datos instanceof Blob ? datos : new Blob([datos], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function leer(file) { return new Uint8Array(await file.arrayBuffer()); }
function esPdf(f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); }
function esImagen(f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name); }

async function abrirVista(bytes) {
  return pdfjsLib.getDocument({ data: bytes.slice(), ...OPC_PDFJS }).promise;
}
async function abrirEdicion(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (doc.isEncrypted) throw new Error('Este PDF está protegido con contraseña. Quita la protección antes de editarlo.');
  return doc;
}
/* Dibuja una página en un lienzo con el ancho indicado (px) */
async function dibujarPagina(pdf, n, ancho, escalaFija) {
  const pag = await pdf.getPage(n);
  const v1 = pag.getViewport({ scale: 1 });
  const escala = escalaFija || ancho / v1.width;
  const vp = pag.getViewport({ scale: escala });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await pag.render({ canvasContext: ctx, viewport: vp }).promise;
  pag.cleanup();
  return c;
}
const lienzoABlob = (c, tipo, cal) => new Promise(r => c.toBlob(r, tipo, cal));
async function guardarPdf(doc) { return doc.save({ useObjectStreams: true }); }

/* Interpreta rangos como «1-3, 5, 8-» para un documento de n páginas. Devuelve grupos de índices (base 0). */
function parsearRangos(txt, n) {
  const grupos = [];
  for (const parte of txt.split(/[,;]+/).map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(parte);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; }
    else if (/^\d+$/.test(parte)) { a = b = +parte; }
    else throw new Error(`«${parte}» no es un rango válido. Usa por ejemplo: 1-3, 5, 8-10`);
    if (a < 1 || b > n || a > b) throw new Error(`El rango «${parte}» está fuera del documento (tiene ${n} páginas).`);
    const g = []; for (let i = a; i <= b; i++) g.push(i - 1);
    grupos.push(g);
  }
  if (!grupos.length) throw new Error('Escribe al menos una página o rango.');
  return grupos;
}

/* ---------- componentes ---------- */
function zonaArchivos(cont, { acepta, multiple, texto, sub }, alSoltar) {
  const z = document.createElement('div');
  z.className = 'zona';
  z.innerHTML = `<div style="font-size:34px">📂</div><div class="grande">${texto}</div><small>${sub || 'o arrastra los archivos aquí'}</small>`;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = acepta; inp.multiple = !!multiple; inp.hidden = true;
  z.appendChild(inp);
  z.onclick = () => inp.click();
  inp.onchange = () => { if (inp.files.length) alSoltar([...inp.files]); inp.value = ''; };
  z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('sobre'); });
  z.addEventListener('dragleave', () => z.classList.remove('sobre'));
  z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('sobre'); if (e.dataTransfer.files.length) alSoltar([...e.dataTransfer.files]); });
  cont.appendChild(z);
  return { el: z, abrir: () => inp.click() };
}
function cabecera(h) {
  vista.innerHTML = `<a href="#" class="volver">← Todas las herramientas</a>
    <div class="cab-h"><span class="ic">${h.ic}</span><h1>${h.nombre}</h1></div><p class="desc">${h.largo || h.desc}</p><div id="area"></div>`;
  return $('#area');
}
function exito(cont, texto, botones = []) {
  cont.querySelectorAll('.exito').forEach(e => e.remove());
  const d = document.createElement('div');
  d.className = 'exito';
  d.innerHTML = `<span style="font-size:24px">✅</span><div style="flex:1">${texto}</div>`;
  botones.forEach(([t, fn, sec]) => { const b = document.createElement('button'); b.className = 'boton' + (sec ? ' sec' : ''); b.textContent = t; b.onclick = fn; d.appendChild(b); });
  cont.appendChild(d);
  d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function ejecutar(txt, fn) {
  cargando(true, txt);
  await espera();
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message || 'No se pudo procesar el archivo.', true); }
  finally { cargando(false); }
}
/* Carga un único PDF y llama a alCargar({file, bytes, pdf}) */
function unSoloPdf(area, alCargar) {
  zonaArchivos(area, { acepta: '.pdf,application/pdf', texto: 'Selecciona un PDF' }, async ([f]) => {
    if (!esPdf(f)) { toast('El archivo debe ser un PDF.', true); return; }
    await ejecutar('Abriendo el PDF…', async () => {
      const bytes = await leer(f);
      await abrirEdicion(bytes); // verifica que se pueda editar
      const pdf = await abrirVista(bytes);
      area.innerHTML = '';
      await alCargar({ file: f, bytes, pdf });
    });
  });
}
function infoArchivo(area, file, pdf, otra) {
  const d = document.createElement('div');
  d.className = 'panel';
  d.style.marginTop = '0';
  d.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:22px">📄</span><div style="flex:1;min-width:0"><b style="word-break:break-all">${esc(file.name)}</b><div class="nota">${pdf.numPages} página${pdf.numPages > 1 ? 's' : ''} · ${fmtTam(file.size)}</div></div><button class="boton sec">Cambiar archivo</button></div>`;
  d.querySelector('button').onclick = otra;
  area.appendChild(d);
}

/* =================== HERRAMIENTAS =================== */
const H = [];

/* ---------- Unir ---------- */
H.push({
  id: 'unir', ic: '🔗', nombre: 'Unir PDF', desc: 'Combina varios PDF en un solo archivo, en el orden que elijas.',
  render(h) {
    const area = cabecera(h);
    const lista = [];
    const ul = document.createElement('ul'); ul.className = 'archivos';
    const pie = document.createElement('div'); pie.className = 'acciones';
    const agregar = async files => {
      const pdfs = files.filter(esPdf);
      if (pdfs.length < files.length) toast('Se omitieron archivos que no son PDF.', true);
      await ejecutar('Leyendo archivos…', async () => {
        for (const f of pdfs) {
          const bytes = await leer(f);
          try { await abrirEdicion(bytes); } catch (e) { toast(`«${f.name}»: ${e.message}`, true); continue; }
          const pdf = await abrirVista(bytes);
          lista.push({ f, bytes, n: pdf.numPages, mini: await dibujarPagina(pdf, 1, 104) });
          pdf.destroy();
        }
      });
      pintar();
    };
    const pintar = () => {
      ul.innerHTML = '';
      lista.forEach((it, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<div class="m"></div><div style="min-width:0"><div class="nom">${i + 1}. ${esc(it.f.name)}</div><div class="det">${it.n} página${it.n > 1 ? 's' : ''} · ${fmtTam(it.f.size)}</div></div>
          <div style="display:flex;gap:4px"><button class="mini" data-m="-1" title="Subir">↑</button><button class="mini" data-m="1" title="Bajar">↓</button><button class="mini x" data-x title="Quitar">✕</button></div>`;
        li.querySelector('.m').appendChild(it.mini);
        li.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const j = i + (+b.dataset.m); if (j < 0 || j >= lista.length) return; [lista[i], lista[j]] = [lista[j], lista[i]]; pintar(); });
        li.querySelector('[data-x]').onclick = () => { lista.splice(i, 1); pintar(); };
        ul.appendChild(li);
      });
      const total = lista.reduce((s, x) => s + x.n, 0);
      pie.innerHTML = '';
      if (!lista.length) return;
      const bAdd = document.createElement('button'); bAdd.className = 'boton sec'; bAdd.textContent = '＋ Agregar más PDF'; bAdd.onclick = () => zona.abrir();
      const bUnir = document.createElement('button'); bUnir.className = 'boton'; bUnir.textContent = `🔗 Unir ${lista.length} archivos (${total} páginas)`;
      bUnir.disabled = lista.length < 2;
      bUnir.onclick = () => ejecutar('Uniendo…', async () => {
        const out = await PDFDocument.create();
        for (const it of lista) {
          const src = await abrirEdicion(it.bytes);
          (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
        }
        const bytes = await guardarPdf(out);
        descargar(bytes, 'unido.pdf');
        exito(area, `<b>PDF unido</b> · ${out.getPageCount()} páginas · ${fmtTam(bytes.length)}`, [['Descargar de nuevo', () => descargar(bytes, 'unido.pdf'), true]]);
      });
      pie.append(bAdd, bUnir);
      if (lista.length < 2) pie.insertAdjacentHTML('beforeend', '<span class="nota">Agrega al menos dos archivos.</span>');
    };
    const zona = zonaArchivos(area, { acepta: '.pdf,application/pdf', multiple: true, texto: 'Selecciona los PDF que quieres unir' }, agregar);
    area.append(ul, pie);
    ul.style.marginTop = '14px';
  }
});

/* ---------- Organizar ---------- */
H.push({
  id: 'organizar', ic: '🗂', nombre: 'Organizar páginas', desc: 'Reordena, rota o elimina páginas de un PDF.',
  largo: 'Arrastra las miniaturas para cambiar el orden (o usa ◀ ▶), gira las páginas que estén de lado y elimina las que sobren.',
  render(h) {
    const area = cabecera(h);
    unSoloPdf(area, async ({ file, bytes, pdf }) => {
      infoArchivo(area, file, pdf, () => h.render(h));
      let pags = Array.from({ length: pdf.numPages }, (_, i) => ({ i, rot: 0, lienzo: null }));
      const barra = document.createElement('div'); barra.className = 'acciones'; barra.style.margin = '14px 0';
      barra.innerHTML = `<button class="boton sec" data-t="izq">↺ Rotar todas</button><button class="boton sec" data-t="der">↻ Rotar todas</button><button class="boton sec" data-t="inv">⇅ Invertir orden</button><button class="boton sec" data-t="res">↶ Restablecer</button><span class="nota" id="cuenta"></span>`;
      const rej = document.createElement('div'); rej.className = 'paginas';
      const pie = document.createElement('div'); pie.className = 'acciones';
      const bGuardar = document.createElement('button'); bGuardar.className = 'boton'; bGuardar.textContent = '💾 Guardar PDF';
      pie.appendChild(bGuardar);
      area.append(barra, rej, pie);
      // miniaturas (una vez)
      for (const p of pags) { p.lienzo = await dibujarPagina(pdf, p.i + 1, 160); }
      let arrastrado = null;
      const pintar = () => {
        rej.innerHTML = '';
        $('#cuenta').textContent = `${pags.length} de ${pdf.numPages} páginas`;
        pags.forEach((p, k) => {
          const d = document.createElement('div');
          d.className = 'pag'; d.draggable = true;
          d.innerHTML = `<div class="lienzo"></div><div class="n">Pág. ${p.i + 1}</div><div class="btns"><button data-a="mi" title="Mover a la izquierda">◀</button><button data-a="ri" title="Girar a la izquierda">↺</button><button data-a="rd" title="Girar a la derecha">↻</button><button data-a="x" title="Eliminar" style="color:#b91c1c">✕</button><button data-a="md" title="Mover a la derecha">▶</button></div>`;
          p.lienzo.style.transform = `rotate(${p.rot}deg)`;
          d.querySelector('.lienzo').appendChild(p.lienzo);
          d.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
            const a = b.dataset.a;
            if (a === 'ri') p.rot = (p.rot + 270) % 360;
            if (a === 'rd') p.rot = (p.rot + 90) % 360;
            if (a === 'x') { if (pags.length === 1) { toast('El PDF debe conservar al menos una página.', true); return; } pags.splice(k, 1); }
            if (a === 'mi' && k > 0) [pags[k - 1], pags[k]] = [pags[k], pags[k - 1]];
            if (a === 'md' && k < pags.length - 1) [pags[k + 1], pags[k]] = [pags[k], pags[k + 1]];
            pintar();
          });
          d.addEventListener('dragstart', e => { arrastrado = k; d.classList.add('arrastrando'); e.dataTransfer.effectAllowed = 'move'; });
          d.addEventListener('dragend', () => d.classList.remove('arrastrando'));
          d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('destino'); });
          d.addEventListener('dragleave', () => d.classList.remove('destino'));
          d.addEventListener('drop', e => { e.preventDefault(); d.classList.remove('destino'); if (arrastrado === null || arrastrado === k) return; const [m] = pags.splice(arrastrado, 1); pags.splice(k, 0, m); arrastrado = null; pintar(); });
          rej.appendChild(d);
        });
      };
      barra.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
        const t = b.dataset.t;
        if (t === 'izq') pags.forEach(p => p.rot = (p.rot + 270) % 360);
        if (t === 'der') pags.forEach(p => p.rot = (p.rot + 90) % 360);
        if (t === 'inv') pags.reverse();
        if (t === 'res') { const l = {}; pags.forEach(p => l[p.i] = p.lienzo); pags = Array.from({ length: pdf.numPages }, (_, i) => ({ i, rot: 0, lienzo: l[i] || null })); pags.filter(p => !p.lienzo).forEach(async p => { p.lienzo = await dibujarPagina(pdf, p.i + 1, 160); pintar(); }); }
        pintar();
      });
      bGuardar.onclick = () => ejecutar('Guardando…', async () => {
        const src = await abrirEdicion(bytes);
        const out = await PDFDocument.create();
        const copias = await out.copyPages(src, pags.map(p => p.i));
        copias.forEach((pg, k) => { pg.setRotation(degrees((pg.getRotation().angle + pags[k].rot) % 360)); out.addPage(pg); });
        const res = await guardarPdf(out);
        const nombre = base(file.name) + '_organizado.pdf';
        descargar(res, nombre);
        exito(area, `<b>Listo</b> · ${pags.length} páginas · ${fmtTam(res.length)}`, [['Descargar de nuevo', () => descargar(res, nombre), true]]);
      });
      pintar();
    });
  }
});

/* ---------- Dividir ---------- */
H.push({
  id: 'dividir', ic: '✂', nombre: 'Dividir y extraer', desc: 'Extrae páginas o separa un PDF en varios archivos.',
  render(h) {
    const area = cabecera(h);
    unSoloPdf(area, async ({ file, bytes, pdf }) => {
      infoArchivo(area, file, pdf, () => h.render(h));
      const n = pdf.numPages;
      const p = document.createElement('div'); p.className = 'panel';
      p.innerHTML = `<h3>¿Qué quieres hacer?</h3>
        <label class="chk"><input type="radio" name="modo" value="extraer" checked> Extraer páginas en un solo PDF</label>
        <label class="chk"><input type="radio" name="modo" value="rangos"> Un PDF por cada rango</label>
        <label class="chk"><input type="radio" name="modo" value="cada"> Separar todas las páginas (un PDF por página)</label>
        <label class="chk"><input type="radio" name="modo" value="grupos"> Dividir cada cierto número de páginas</label>
        <div class="opciones" style="margin-top:12px">
          <div class="opcion" id="oRango"><label>Páginas</label><input type="text" id="rango" value="1-${Math.min(n, 3)}" placeholder="p. ej. 1-3, 5, 8-"></div>
          <div class="opcion" id="oGrupo" hidden><label>Páginas por archivo</label><input type="number" id="grupo" min="1" max="${n}" value="${Math.min(2, n)}"></div>
        </div>
        <p class="nota" id="ayudaModo">Escribe páginas sueltas o rangos separados por comas. «8-» significa de la 8 al final.</p>`;
      const pie = document.createElement('div'); pie.className = 'acciones';
      const b = document.createElement('button'); b.className = 'boton'; b.textContent = '✂ Dividir PDF';
      pie.appendChild(b);
      area.append(p, pie);
      const modo = () => p.querySelector('[name=modo]:checked').value;
      p.querySelectorAll('[name=modo]').forEach(r => r.onchange = () => {
        $('#oRango', p).hidden = !['extraer', 'rangos'].includes(modo());
        $('#oGrupo', p).hidden = modo() !== 'grupos';
        $('#ayudaModo', p).hidden = $('#oRango', p).hidden;
      });
      b.onclick = () => ejecutar('Dividiendo…', async () => {
        const src = await abrirEdicion(bytes);
        let grupos;
        if (modo() === 'cada') grupos = Array.from({ length: n }, (_, i) => [i]);
        else if (modo() === 'grupos') { const g = Math.max(1, parseInt($('#grupo', p).value) || 1); grupos = []; for (let i = 0; i < n; i += g) grupos.push(Array.from({ length: Math.min(g, n - i) }, (_, k) => i + k)); }
        else { grupos = parsearRangos($('#rango', p).value, n); if (modo() === 'extraer') grupos = [grupos.flat()]; }
        const nombreDe = g => g.length === 1 ? `pag_${g[0] + 1}` : `pags_${g[0] + 1}-${g[g.length - 1] + 1}`;
        if (grupos.length === 1) {
          const out = await PDFDocument.create();
          (await out.copyPages(src, grupos[0])).forEach(pg => out.addPage(pg));
          const res = await guardarPdf(out);
          const nom = `${base(file.name)}_${modo() === 'extraer' && grupos[0].length > 1 ? 'extracto' : nombreDe(grupos[0])}.pdf`;
          descargar(res, nom);
          exito(area, `<b>PDF creado</b> · ${grupos[0].length} página${grupos[0].length > 1 ? 's' : ''} · ${fmtTam(res.length)}`, [['Descargar de nuevo', () => descargar(res, nom), true]]);
        } else {
          const zip = new JSZip();
          for (const g of grupos) {
            cargando(true, `Creando archivo ${grupos.indexOf(g) + 1} de ${grupos.length}…`);
            const out = await PDFDocument.create();
            (await out.copyPages(src, g)).forEach(pg => out.addPage(pg));
            zip.file(`${base(file.name)}_${nombreDe(g)}.pdf`, await guardarPdf(out));
          }
          const blob = await zip.generateAsync({ type: 'blob' });
          const nom = base(file.name) + '_dividido.zip';
          descargar(blob, nom);
          exito(area, `<b>${grupos.length} archivos PDF</b> en un ZIP · ${fmtTam(blob.size)}`, [['Descargar de nuevo', () => descargar(blob, nom), true]]);
        }
      });
    });
  }
});

/* ---------- Comprimir ---------- */
H.push({
  id: 'comprimir', ic: '🗜', nombre: 'Comprimir PDF', desc: 'Reduce el tamaño del archivo para enviarlo o subirlo a una plataforma.',
  render(h) {
    const area = cabecera(h);
    unSoloPdf(area, async ({ file, bytes, pdf }) => {
      infoArchivo(area, file, pdf, () => h.render(h));
      const p = document.createElement('div'); p.className = 'panel';
      p.innerHTML = `<h3>Nivel de compresión</h3>
        <label class="chk"><input type="radio" name="niv" value="0"> <b>Ligera</b> — optimiza la estructura sin tocar el contenido (el texto sigue seleccionable)</label>
        <label class="chk"><input type="radio" name="niv" value="1"> <b>Recomendada</b> — buena calidad (150 ppp)</label>
        <label class="chk"><input type="radio" name="niv" value="2" checked> <b>Fuerte</b> — calidad media (110 ppp)</label>
        <label class="chk"><input type="radio" name="niv" value="3"> <b>Máxima</b> — archivo muy pequeño (80 ppp)</label>
        <div class="aviso">En los niveles Recomendada, Fuerte y Máxima cada página se convierte en imagen: el resultado se ve igual, pero el texto ya no se puede seleccionar ni buscar. Funciona muy bien con documentos escaneados y PDF con muchas fotos.</div>`;
      const pie = document.createElement('div'); pie.className = 'acciones';
      const b = document.createElement('button'); b.className = 'boton'; b.textContent = '🗜 Comprimir';
      pie.appendChild(b);
      area.append(p, pie);
      b.onclick = () => ejecutar('Comprimiendo…', async () => {
        const niv = +p.querySelector('[name=niv]:checked').value;
        let res;
        if (niv === 0) res = await guardarPdf(await abrirEdicion(bytes));
        else {
          const [dpi, cal] = [[0, 0], [150, 0.78], [110, 0.62], [80, 0.5]][niv];
          const out = await PDFDocument.create();
          for (let i = 1; i <= pdf.numPages; i++) {
            cargando(true, `Comprimiendo página ${i} de ${pdf.numPages}…`);
            const pag = await pdf.getPage(i);
            const v = pag.getViewport({ scale: 1 });
            const c = await dibujarPagina(pdf, i, 0, dpi / 72);
            const jpg = await (await lienzoABlob(c, 'image/jpeg', cal)).arrayBuffer();
            const img = await out.embedJpg(jpg);
            const pg = out.addPage([v.width, v.height]);
            pg.drawImage(img, { x: 0, y: 0, width: v.width, height: v.height });
            c.width = c.height = 0;
          }
          res = await guardarPdf(out);
        }
        const nom = base(file.name) + '_comprimido.pdf';
        const ahorro = 1 - res.length / file.size;
        if (res.length >= file.size) {
          exito(area, `<b>Este PDF ya está bien comprimido.</b> El resultado (${fmtTam(res.length)}) no es más pequeño que el original (${fmtTam(file.size)}). Prueba un nivel más fuerte o conserva el original.`, [['Descargar de todas formas', () => descargar(res, nom), true]]);
        } else {
          descargar(res, nom);
          exito(area, `<b>${fmtTam(file.size)} → ${fmtTam(res.length)}</b> · ${Math.round(ahorro * 100)} % más pequeño`, [['Descargar de nuevo', () => descargar(res, nom), true]]);
        }
      });
    });
  }
});

/* ---------- Imágenes a PDF ---------- */
H.push({
  id: 'imagenes', ic: '🖼', nombre: 'Imágenes a PDF', desc: 'Convierte fotos o capturas (JPG, PNG, WebP) en un PDF.',
  largo: 'Ideal para convertir fotos de un trabajo o de documentos en un solo PDF. Ordena las imágenes y elige el tamaño de página.',
  render(h) {
    const area = cabecera(h);
    const lista = [];
    const ul = document.createElement('ul'); ul.className = 'archivos'; ul.style.marginTop = '14px';
    const op = document.createElement('div'); op.className = 'panel'; op.hidden = true;
    op.innerHTML = `<div class="opciones">
      <div class="opcion"><label>Tamaño de página</label><select id="tam"><option value="a4">A4</option><option value="carta">Carta</option><option value="img">Igual a la imagen</option></select></div>
      <div class="opcion"><label>Márgenes</label><select id="mar"><option value="0">Sin márgenes</option><option value="28" selected>Pequeños (1 cm)</option><option value="57">Normales (2 cm)</option></select></div>
      <div class="opcion"><label>Calidad</label><select id="cal"><option value="0.92">Alta</option><option value="0.8" selected>Buena (archivo más liviano)</option><option value="0.65">Media</option></select></div></div>
      <p class="nota">La orientación (vertical u horizontal) se elige automáticamente según cada imagen.</p>`;
    const pie = document.createElement('div'); pie.className = 'acciones';
    const agregar = async files => {
      const imgs = files.filter(esImagen);
      if (imgs.length < files.length) toast('Algunos archivos no son imágenes compatibles y se omitieron.', true);
      await ejecutar('Cargando imágenes…', async () => {
        for (const f of imgs) {
          try {
            const bmp = await createImageBitmap(f);
            const c = document.createElement('canvas'); const k = 104 / Math.max(bmp.width, bmp.height);
            c.width = Math.max(1, bmp.width * k); c.height = Math.max(1, bmp.height * k);
            c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
            lista.push({ f, bmp, mini: c });
          } catch (e) { toast(`No se pudo leer «${f.name}».`, true); }
        }
      });
      pintar();
    };
    const pintar = () => {
      ul.innerHTML = '';
      op.hidden = !lista.length;
      lista.forEach((it, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<div class="m"></div><div style="min-width:0"><div class="nom">${i + 1}. ${esc(it.f.name)}</div><div class="det">${it.bmp.width} × ${it.bmp.height} px · ${fmtTam(it.f.size)}</div></div><div style="display:flex;gap:4px"><button class="mini" data-m="-1">↑</button><button class="mini" data-m="1">↓</button><button class="mini x" data-x>✕</button></div>`;
        li.querySelector('.m').appendChild(it.mini);
        li.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const j = i + (+b.dataset.m); if (j < 0 || j >= lista.length) return; [lista[i], lista[j]] = [lista[j], lista[i]]; pintar(); });
        li.querySelector('[data-x]').onclick = () => { lista.splice(i, 1); pintar(); };
        ul.appendChild(li);
      });
      pie.innerHTML = '';
      if (!lista.length) return;
      const bAdd = document.createElement('button'); bAdd.className = 'boton sec'; bAdd.textContent = '＋ Agregar imágenes'; bAdd.onclick = () => zona.abrir();
      const bOk = document.createElement('button'); bOk.className = 'boton'; bOk.textContent = `📄 Crear PDF (${lista.length} página${lista.length > 1 ? 's' : ''})`;
      bOk.onclick = () => ejecutar('Creando PDF…', async () => {
        const tam = $('#tam').value, mar = +$('#mar').value, cal = +$('#cal').value;
        const out = await PDFDocument.create();
        for (const [k, it] of lista.entries()) {
          cargando(true, `Agregando imagen ${k + 1} de ${lista.length}…`);
          // se redibuja en un lienzo: respeta la orientación de las fotos del celular y limita el tamaño
          const lim = 3000, esc2 = Math.min(1, lim / Math.max(it.bmp.width, it.bmp.height));
          const c = document.createElement('canvas'); c.width = Math.round(it.bmp.width * esc2); c.height = Math.round(it.bmp.height * esc2);
          const ctx = c.getContext('2d');
          const png = /png$/i.test(it.f.type) || /\.png$/i.test(it.f.name);
          if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
          ctx.drawImage(it.bmp, 0, 0, c.width, c.height);
          const datos = await (await lienzoABlob(c, png ? 'image/png' : 'image/jpeg', cal)).arrayBuffer();
          const img = png ? await out.embedPng(datos) : await out.embedJpg(datos);
          const iw = it.bmp.width * 0.75, ih = it.bmp.height * 0.75; // 96 ppp → puntos
          let W, Hh;
          if (tam === 'img') { W = iw + 2 * mar; Hh = ih + 2 * mar; }
          else { [W, Hh] = tam === 'a4' ? [595.28, 841.89] : [612, 792]; if (iw > ih) [W, Hh] = [Hh, W]; }
          const pg = out.addPage([W, Hh]);
          const k2 = Math.min((W - 2 * mar) / iw, (Hh - 2 * mar) / ih, tam === 'img' ? 1 : Infinity);
          const w = iw * k2, hh = ih * k2;
          pg.drawImage(img, { x: (W - w) / 2, y: (Hh - hh) / 2, width: w, height: hh });
        }
        const res = await guardarPdf(out);
        const nom = lista.length === 1 ? base(lista[0].f.name) + '.pdf' : 'imagenes.pdf';
        descargar(res, nom);
        exito(area, `<b>PDF creado</b> · ${lista.length} página${lista.length > 1 ? 's' : ''} · ${fmtTam(res.length)}`, [['Descargar de nuevo', () => descargar(res, nom), true]]);
      });
      pie.append(bAdd, bOk);
    };
    const zona = zonaArchivos(area, { acepta: 'image/*', multiple: true, texto: 'Selecciona las imágenes', sub: 'JPG, PNG, WebP… también puedes arrastrarlas aquí' }, agregar);
    area.append(ul, op, pie);
  }
});

/* ---------- PDF a imágenes ---------- */
H.push({
  id: 'aimagen', ic: '📸', nombre: 'PDF a imágenes', desc: 'Convierte cada página en una imagen JPG o PNG.',
  render(h) {
    const area = cabecera(h);
    unSoloPdf(area, async ({ file, bytes, pdf }) => {
      infoArchivo(area, file, pdf, () => h.render(h));
      const n = pdf.numPages;
      const p = document.createElement('div'); p.className = 'panel';
      p.innerHTML = `<div class="opciones">
        <div class="opcion"><label>Formato</label><select id="fmt"><option value="jpg">JPG (más liviano)</option><option value="png">PNG (máxima nitidez)</option></select></div>
        <div class="opcion"><label>Resolución</label><select id="dpi"><option value="96">Pantalla (96 ppp)</option><option value="150" selected>Buena (150 ppp)</option><option value="300">Impresión (300 ppp)</option></select></div>
        <div class="opcion"><label>Páginas</label><input type="text" id="pgs" value="1-${n}"></div></div>`;
      const pie = document.createElement('div'); pie.className = 'acciones';
      const b = document.createElement('button'); b.className = 'boton'; b.textContent = '🖼 Convertir';
      pie.appendChild(b);
      area.append(p, pie);
      b.onclick = () => ejecutar('Convirtiendo…', async () => {
        const idx = parsearRangos($('#pgs', p).value, n).flat();
        const fmt = $('#fmt', p).value, dpi = +$('#dpi', p).value;
        const tipo = fmt === 'png' ? 'image/png' : 'image/jpeg';
        const archivos = [];
        for (const [k, i] of idx.entries()) {
          cargando(true, `Convirtiendo página ${k + 1} de ${idx.length}…`);
          const c = await dibujarPagina(pdf, i + 1, 0, dpi / 72);
          archivos.push({ nombre: `${base(file.name)}_pag${String(i + 1).padStart(String(n).length, '0')}.${fmt}`, blob: await lienzoABlob(c, tipo, 0.9) });
          c.width = c.height = 0;
        }
        if (archivos.length === 1) {
          descargar(archivos[0].blob, archivos[0].nombre);
          exito(area, `<b>Imagen creada</b> · ${fmtTam(archivos[0].blob.size)}`, [['Descargar de nuevo', () => descargar(archivos[0].blob, archivos[0].nombre), true]]);
        } else {
          const zip = new JSZip();
          archivos.forEach(a => zip.file(a.nombre, a.blob));
          const blob = await zip.generateAsync({ type: 'blob' });
          const nom = base(file.name) + '_imagenes.zip';
          descargar(blob, nom);
          exito(area, `<b>${archivos.length} imágenes</b> en un ZIP · ${fmtTam(blob.size)}`, [['Descargar de nuevo', () => descargar(blob, nom), true]]);
        }
      });
    });
  }
});

/* ---------- Numerar páginas ---------- */
H.push({
  id: 'numerar', ic: '🔢', nombre: 'Numerar páginas', desc: 'Agrega números de página en la posición y formato que elijas.',
  render(h) {
    const area = cabecera(h);
    unSoloPdf(area, async ({ file, bytes, pdf }) => {
      infoArchivo(area, file, pdf, () => h.render(h));
      const p = document.createElement('div'); p.className = 'panel';
      p.innerHTML = `<div class="opciones">
        <div class="opcion"><label>Posición</label><select id="pos"><option value="bc">Abajo, centro</option><option value="bd" selected>Abajo, derecha</option><option value="bi">Abajo, izquierda</option><option value="ad">Arriba, derecha</option><option value="ac">Arriba, centro</option></select></div>
        <div class="opcion"><label>Formato</label><select id="fmtn"><option value="n">1</option><option value="pn">Página 1</option><option value="nN" selected>1 de 10</option><option value="pnN">Página 1 de 10</option></select></div>
        <div class="opcion"><label>Empezar en</label><input type="number" id="ini" value="1" style="width:90px;min-width:0"></div>
        <div class="opcion"><label>Tamaño de letra</label><input type="number" id="tl" value="10" min="6" max="30" style="width:90px;min-width:0"></div></div>
        <label class="chk" style="margin-top:10px"><input type="checkbox" id="saltar"> No numerar la primera página (portada)</label>`;
      const pie = document.createElement('div'); pie.className = 'acciones';
      const b = document.createElement('button'); b.className = 'boton'; b.textContent = '🔢 Numerar';
      pie.appendChild(b);
      area.append(p, pie);
      b.onclick = () => ejecutar('Numerando…', async () => {
        const doc = await abrirEdicion(bytes);
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pos = $('#pos', p).value, fmt = $('#fmtn', p).value, ini = parseInt($('#ini', p).value) || 1, tl = +$('#tl', p).value || 10, saltar = $('#saltar', p).checked;
        const pags = doc.getPages();
        const total = pags.length - (saltar ? 1 : 0) + ini - 1;
        pags.forEach((pg, i) => {
          if (saltar && i === 0) return;
          const num = i + ini - (saltar ? 1 : 0);
          const t = { n: `${num}`, pn: `Página ${num}`, nN: `${num} de ${total}`, pnN: `Página ${num} de ${total}` }[fmt];
          const cb = pg.getCropBox(), w = font.widthOfTextAtSize(t, tl), m = 28;
          const x = pos.endsWith('c') ? cb.x + (cb.width - w) / 2 : pos.endsWith('d') ? cb.x + cb.width - m - w : cb.x + m;
          const y = pos.startsWith('a') ? cb.y + cb.height - m : cb.y + m - tl / 2;
          pg.drawText(t, { x, y, size: tl, font, color: rgb(0.15, 0.15, 0.15) });
        });
        const res = await guardarPdf(doc);
        const nom = base(file.name) + '_numerado.pdf';
        descargar(res, nom);
        exito(area, `<b>Páginas numeradas</b> · ${fmtTam(res.length)}`, [['Descargar de nuevo', () => descargar(res, nom), true]]);
      });
    });
  }
});

/* ---------- Marca de agua ---------- */
H.push({
  id: 'marca', ic: '💧', nombre: 'Marca de agua', desc: 'Escribe un texto como «BORRADOR» o «CONFIDENCIAL» sobre todas las páginas.',
  render(h) {
    const area = cabecera(h);
    unSoloPdf(area, async ({ file, bytes, pdf }) => {
      infoArchivo(area, file, pdf, () => h.render(h));
      const p = document.createElement('div'); p.className = 'panel';
      p.innerHTML = `<div class="opciones">
        <div class="opcion"><label>Texto</label><input type="text" id="txt" value="BORRADOR" style="min-width:220px"></div>
        <div class="opcion"><label>Tamaño</label><input type="number" id="tm" value="60" min="10" max="200" style="width:90px;min-width:0"></div>
        <div class="opcion"><label>Color</label><select id="col"><option value="g">Gris</option><option value="r">Rojo</option><option value="a">Azul</option></select></div>
        <div class="opcion"><label>Dirección</label><select id="dir"><option value="45">Diagonal</option><option value="0">Horizontal</option></select></div>
        <div class="opcion"><label>Transparencia: <span id="opv">25 %</span></label><input type="range" id="op" min="5" max="80" value="25"></div></div>`;
      const pie = document.createElement('div'); pie.className = 'acciones';
      const b = document.createElement('button'); b.className = 'boton'; b.textContent = '💧 Aplicar marca de agua';
      pie.appendChild(b);
      area.append(p, pie);
      $('#op', p).oninput = e => $('#opv', p).textContent = e.target.value + ' %';
      b.onclick = () => ejecutar('Aplicando…', async () => {
        const txt = $('#txt', p).value.trim();
        if (!txt) throw new Error('Escribe el texto de la marca de agua.');
        const doc = await abrirEdicion(bytes);
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        let tm = +$('#tm', p).value || 60;
        const ang = +$('#dir', p).value, op = +$('#op', p).value / 100;
        const color = { g: rgb(0.5, 0.5, 0.5), r: rgb(0.8, 0.1, 0.1), a: rgb(0.1, 0.25, 0.75) }[$('#col', p).value];
        for (const pg of doc.getPages()) {
          const cb = pg.getCropBox();
          let s = tm, w = font.widthOfTextAtSize(txt, s);
          const maxW = (ang ? Math.hypot(cb.width, cb.height) : cb.width) * 0.85;
          if (w > maxW) { s = s * maxW / w; w = font.widthOfTextAtSize(txt, s); }
          const th = ang * Math.PI / 180, dx = w / 2, dy = s * 0.35;
          const cx = cb.x + cb.width / 2, cy = cb.y + cb.height / 2;
          pg.drawText(txt, { x: cx - (dx * Math.cos(th) - dy * Math.sin(th)), y: cy - (dx * Math.sin(th) + dy * Math.cos(th)), size: s, font, color, opacity: op, rotate: degrees(ang) });
        }
        const res = await guardarPdf(doc);
        const nom = base(file.name) + '_marca.pdf';
        descargar(res, nom);
        exito(area, `<b>Marca de agua aplicada</b> · ${fmtTam(res.length)}`, [['Descargar de nuevo', () => descargar(res, nom), true]]);
      });
    });
  }
});

/* ---------- Firmar ---------- */
H.push({
  id: 'firmar', ic: '✍', nombre: 'Firmar PDF', desc: 'Dibuja, escribe o sube tu firma y colócala donde la necesites.',
  largo: 'Crea tu firma, luego haz clic sobre la página en el lugar donde quieres ponerla. Puedes firmar varias páginas.',
  render(h) {
    const area = cabecera(h);
    unSoloPdf(area, async ({ file, bytes, pdf }) => {
      infoArchivo(area, file, pdf, () => h.render(h));
      let firma = null; // {url, w, h}
      const colocadas = []; // {pag, x, y, w} fracciones de la página
      // Paso 1: crear firma
      const p1 = document.createElement('div'); p1.className = 'panel';
      p1.innerHTML = `<h3>1. Crea tu firma</h3>
        <div class="pestanas"><button data-p="dib" class="act">✏ Dibujar</button><button data-p="esc">⌨ Escribir</button><button data-p="img">🖼 Subir imagen</button></div>
        <div data-s="dib"><canvas class="firma-pad" width="1040" height="360"></canvas>
          <div class="acciones" style="margin-top:8px"><select id="colF"><option value="#111">Negro</option><option value="#1d3fa8">Azul</option></select><button class="boton sec" id="limpiar">Borrar</button><span class="nota">Dibuja con el mouse o con el dedo.</span></div></div>
        <div data-s="esc" hidden><div class="opciones"><div class="opcion"><label>Tu nombre</label><input type="text" id="nomF" placeholder="Escribe tu nombre" style="min-width:260px"></div>
          <div class="opcion"><label>Estilo</label><select id="estF"><option value="italic 64px 'Segoe Script','Brush Script MT','Lucida Handwriting',cursive">Manuscrita</option><option value="italic 60px Georgia,serif">Cursiva clásica</option></select></div></div></div>
        <div data-s="img" hidden><input type="file" id="imgF" accept="image/png,image/jpeg"><p class="nota">Recomendado: PNG con fondo transparente. Si es una foto de tu firma sobre papel blanco, el fondo blanco se vuelve transparente automáticamente.</p></div>
        <div class="acciones"><button class="boton" id="usar">✔ Usar esta firma</button><img id="prevF" class="firma-prev" hidden alt="Firma"></div>`;
      // Paso 2: colocar
      const p2 = document.createElement('div'); p2.className = 'panel'; p2.hidden = true;
      p2.innerHTML = `<h3>2. Haz clic donde quieres la firma</h3>
        <div class="nav-pag"><button class="mini" id="ant">◀</button><span id="numP"></span><button class="mini" id="sig">▶</button>
          <span style="margin-left:14px" class="nota">Tamaño</span><input type="range" id="tamF" min="8" max="60" value="25"><button class="mini" id="deshacer">↶ Deshacer</button></div>
        <div class="lienzo-firma" id="hoja"></div>
        <div class="acciones"><button class="boton" id="guardarF" disabled>💾 Guardar PDF firmado</button><span class="nota" id="nF">Aún no has colocado la firma.</span></div>`;
      area.append(p1, p2);
      // pestañas
      let pest = 'dib';
      p1.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
        pest = b.dataset.p;
        p1.querySelectorAll('[data-p]').forEach(x => x.classList.toggle('act', x === b));
        p1.querySelectorAll('[data-s]').forEach(s => s.hidden = s.dataset.s !== pest);
      });
      // pad de dibujo
      const pad = p1.querySelector('.firma-pad'), pc = pad.getContext('2d');
      let dibujando = false, hayTrazo = false, ult = null;
      const pt = e => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height }; };
      pad.addEventListener('pointerdown', e => { dibujando = true; ult = pt(e); pad.setPointerCapture(e.pointerId); });
      pad.addEventListener('pointermove', e => {
        if (!dibujando) return;
        const q = pt(e);
        pc.strokeStyle = $('#colF', p1).value; pc.lineWidth = 5; pc.lineCap = 'round'; pc.lineJoin = 'round';
        pc.beginPath(); pc.moveTo(ult.x, ult.y); pc.lineTo(q.x, q.y); pc.stroke();
        ult = q; hayTrazo = true;
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => pad.addEventListener(ev, () => dibujando = false));
      $('#limpiar', p1).onclick = () => { pc.clearRect(0, 0, pad.width, pad.height); hayTrazo = false; };
      // recorta un lienzo al área con tinta y lo devuelve como PNG
      function recortar(c) {
        const ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 < 0) return null;
        const pad2 = 6, w = x1 - x0 + 1 + 2 * pad2, hh = y1 - y0 + 1 + 2 * pad2;
        const o = document.createElement('canvas'); o.width = w; o.height = hh;
        o.getContext('2d').drawImage(c, x0 - pad2, y0 - pad2, w, hh, 0, 0, w, hh);
        return { url: o.toDataURL('image/png'), w, h: hh };
      }
      $('#usar', p1).onclick = async () => {
        let r = null;
        if (pest === 'dib') { if (!hayTrazo) { toast('Dibuja tu firma primero.', true); return; } r = recortar(pad); }
        else if (pest === 'esc') {
          const nom = $('#nomF', p1).value.trim();
          if (!nom) { toast('Escribe tu nombre.', true); return; }
          const c = document.createElement('canvas'); c.width = 1200; c.height = 220;
          const ctx = c.getContext('2d'); ctx.font = $('#estF', p1).value; ctx.fillStyle = '#111'; ctx.textBaseline = 'middle';
          ctx.fillText(nom, 20, 110);
          r = recortar(c);
        } else {
          const f = $('#imgF', p1).files[0];
          if (!f) { toast('Selecciona la imagen de tu firma.', true); return; }
          const bmp = await createImageBitmap(f);
          const k = Math.min(1, 1200 / bmp.width);
          const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
          const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0, c.width, c.height);
          // fondo claro → transparente
          const im = ctx.getImageData(0, 0, c.width, c.height), d = im.data;
          for (let i = 0; i < d.length; i += 4) { const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; if (lum > 200) d[i + 3] = 0; }
          ctx.putImageData(im, 0, 0);
          r = recortar(c);
        }
        if (!r) { toast('No se detectó ninguna firma.', true); return; }
        firma = r;
        const pv = $('#prevF', p1); pv.src = r.url; pv.hidden = false;
        p2.hidden = false;
        await mostrar();
        p2.scrollIntoView({ behavior: 'smooth' });
      };
      // vista de la página
      let actual = 1, lienzo = null;
      const hoja = $('#hoja', p2);
      async function mostrar() {
        $('#numP', p2).textContent = `Página ${actual} de ${pdf.numPages}`;
        const ancho = Math.min(820, area.clientWidth - 40);
        lienzo = await dibujarPagina(pdf, actual, ancho * (window.devicePixelRatio > 1 ? 2 : 1));
        lienzo.style.width = ancho + 'px';
        hoja.innerHTML = ''; hoja.appendChild(lienzo);
        pintarColocadas();
      }
      function pintarColocadas() {
        hoja.querySelectorAll('.colocada').forEach(e => e.remove());
        colocadas.filter(c => c.pag === actual).forEach(c => {
          const d = document.createElement('div'); d.className = 'colocada';
          const W = lienzo.clientWidth, Hh = lienzo.clientHeight, w = c.w * W, hh = w * c.h / c.wImg;
          Object.assign(d.style, { left: (c.x * W - w / 2) + 'px', top: (c.y * Hh - hh / 2) + 'px', width: w + 'px', height: hh + 'px' });
          d.innerHTML = `<img src="${c.url}" alt="">`;
          hoja.appendChild(d);
        });
        const n = colocadas.length;
        $('#nF', p2).textContent = n ? `${n} firma${n > 1 ? 's' : ''} colocada${n > 1 ? 's' : ''}.` : 'Aún no has colocado la firma.';
        $('#guardarF', p2).disabled = !n;
      }
      hoja.addEventListener('click', e => {
        if (!firma || !lienzo) return;
        const r = lienzo.getBoundingClientRect();
        colocadas.push({ pag: actual, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: +$('#tamF', p2).value / 100, url: firma.url, wImg: firma.w, h: firma.h });
        pintarColocadas();
      });
      $('#ant', p2).onclick = () => { if (actual > 1) { actual--; mostrar(); } };
      $('#sig', p2).onclick = () => { if (actual < pdf.numPages) { actual++; mostrar(); } };
      $('#deshacer', p2).onclick = () => { colocadas.pop(); pintarColocadas(); };
      $('#tamF', p2).oninput = () => { const ult2 = colocadas.filter(c => c.pag === actual).pop(); if (ult2) { ult2.w = +$('#tamF', p2).value / 100; pintarColocadas(); } };
      $('#guardarF', p2).onclick = () => ejecutar('Firmando…', async () => {
        const doc = await abrirEdicion(bytes);
        const cache = {};
        for (const c of colocadas) {
          if (!cache[c.url]) cache[c.url] = await doc.embedPng(c.url);
          const pg = doc.getPage(c.pag - 1), cb = pg.getCropBox();
          const w = c.w * cb.width, hh = w * c.h / c.wImg;
          pg.drawImage(cache[c.url], { x: cb.x + c.x * cb.width - w / 2, y: cb.y + (1 - c.y) * cb.height - hh / 2, width: w, height: hh });
        }
        const res = await guardarPdf(doc);
        const nom = base(file.name) + '_firmado.pdf';
        descargar(res, nom);
        exito(area, `<b>PDF firmado</b> · ${fmtTam(res.length)}`, [['Descargar de nuevo', () => descargar(res, nom), true]]);
      });
    });
  }
});

/* =================== NAVEGACIÓN =================== */
function inicio() {
  document.title = 'Herramientas PDF — gratis y privadas';
  vista.innerHTML = `<div class="titulo"><h1>Herramientas PDF</h1><p>Gratis, sin registro y sin subir tus archivos a internet: todo ocurre en tu navegador.</p></div>
    <div class="rejilla">${H.map(h => `<a class="tarjeta" href="#${h.id}"><span class="ic">${h.ic}</span><b>${h.nombre}</b><span>${h.desc}</span></a>`).join('')}</div>`;
}
function ruta() {
  const id = location.hash.slice(1);
  const h = H.find(x => x.id === id);
  if (h) { document.title = h.nombre + ' — Herramientas PDF'; h.render(h); }
  else inicio();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', ruta);
ruta();
