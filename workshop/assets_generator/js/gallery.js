/*
 * GALLERY.JS
 * ---------------------------------------------------------------------
 * Manages the in-memory "session gallery" of tokens created during
 * the current design session. Handles saving, rendering thumbnails,
 * duplicating a saved token's full styling back to the designer, and
 * bundling all saved assets into a downloadable ZIP file.
 *
 * Contains:
 *   - saveToGallery(): snapshots the current design and adds it to
 *     the list.
 *   - renderGallery(): redraws the gallery UI strip with thumbnails
 *     and duplicate buttons.
 *   - duplicateToken(): restores a saved unit's full configuration
 *     (colors, shape, font, hierarchy, hierarchy position, label
 *     position) to the designer controls.
 *   - downloadAllZip(): generates a ZIP file containing all gallery
 *     tokens in the selected export format.
 *   - openLightbox() / closeLightbox(): handles the full-size image
 *     preview overlay.
 * ---------------------------------------------------------------------
 */

function saveToGallery() {
    const cfg = buildDesignerConfig();
    renderUnitToCanvas(cfg, (dataUrl) => {
        savedTokens.push({ dataUrl, config: cfg });
        renderGallery();
    });
}

function renderGallery() {
    const strip = document.getElementById('gallery-strip');
    if (!strip) return;
    strip.innerHTML = "";
    
    if (savedTokens.length === 0) {
        strip.innerHTML = '<span id="gallery-empty">Empty</span>';
        return;
    }

    savedTokens.forEach((t, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'gallery-item';

        const img = document.createElement('img');
        img.src = t.dataUrl;
        img.onclick = () => openLightbox(t.dataUrl);
        wrap.appendChild(img);

        const dupBtn = document.createElement('button');
        dupBtn.type = 'button';
        dupBtn.className = 'dup-btn';
        dupBtn.innerHTML = '⧉';
        dupBtn.onclick = (e) => { e.stopPropagation(); duplicateToken(i); };
        wrap.appendChild(dupBtn);

        strip.appendChild(wrap);
    });
}

function duplicateToken(index) {
    const t = savedTokens[index];
    if (!t || !t.config) return;
    const c = t.config;

    selectedShape = c.shape;
    selectedPosition = c.position;
    selectedLabelPosition = c.labelPosition || 'inside';
    fontSize = c.fontSize;
    uploadedImage = c.image;
    uploadedImageNaturalW = c.imgW;
    uploadedImageNaturalH = c.imgH;
    uploadedImageIsSvg = c.assetType === 'svg';
    uploadedImageSvgText = c.assetSvgText || "";

    document.getElementById('inColor').value = c.color;
    document.getElementById('inStrokeColor').value = c.strokeColor;
    document.getElementById('inTextColor').value = c.textColor;
    document.getElementById('inHierarchy').value = c.hierarchy;
    document.getElementById('inNumber').value = c.number;
    document.getElementById('inOpacity').value = c.opacity;
    document.getElementById('inFontSize').value = c.fontSize;
    document.getElementById('inImgZoom').value = c.imgZoom;
    document.getElementById('inImgOffsetX').value = c.imgOffsetX;
    document.getElementById('inImgOffsetY').value = c.imgOffsetY;

    document.querySelectorAll('#shapeToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.shape === c.shape));
    document.querySelectorAll('#positionToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.pos === c.position));
    document.querySelectorAll('#labelPositionToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.labelpos === selectedLabelPosition));

    setFontFamily(c.fontFamily);

    draw();
}

function downloadAllZip() {
    if (!window.JSZip) {
        alert("JSZip library not found.");
        return;
    }
    if (savedTokens.length === 0) return;

    const prefixRaw = document.getElementById('inBatchPrefix').value;
    const prefix = sanitizeFileNameSegment(prefixRaw) || "Batch";
    const zip = new JSZip();
    const format = selectedFormat;

    savedTokens.forEach((t, i) => {
        const fileName = buildFileNameFromParts(t.config.hierarchy, t.config.number, i + 1, prefix) + "." + format;
        if (format === 'svg') {
            zip.file(fileName, buildUnitSvgString(t.config));
        } else {
            const base64Data = t.dataUrl.split(",")[1];
            zip.file(fileName, base64Data, { base64: true });
        }
    });

    zip.generateAsync({ type: "blob" }).then(function(content) {
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.download = `${prefix}_Gallery.zip`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    });
}

function openLightbox(dataUrl) {
    document.getElementById('lightbox-img').src = dataUrl;
    document.getElementById('lightbox').style.display = 'flex';
}

function closeLightbox(e) {
    document.getElementById('lightbox').style.display = 'none';
}
