/*
 * UI-CONTROLS.JS
 * ---------------------------------------------------------------------
 * Wires up the Unit Designer sidebar controls, keeps the live
 * HTML/CSS preview (#token-container) in sync with them, manages the
 * DARK/LIGHT theme toggle, handles font selection via the button
 * grid, persists the designer's preferences to localStorage, and
 * bootstraps the app on load. This file is the LAST Histograph
 * <script> tag loaded in index.html, so the bootstrap code at the
 * bottom runs only once every other module's functions and
 * state.js's defaults are already defined.
 *
 * Contains:
 *   - toggleTheme(): switches the interface between light and dark
 *     mode.
 *   - setShape() / setPosition() / setLabelPosition() / setFormat() /
 *     setFontSize(): update the relevant piece of shared state and
 *     toggle the active button styling, then re-render the preview.
 *   - setFontFamily(): updates the global font family state and
 *     refreshes the button grid UI.
 *   - getFontFamily(): returns the currently selected font family.
 *   - handleImage(): reads an uploaded background image/flag file,
 *     detects whether it's an SVG, and stores both its data URL and
 *     (for SVGs) raw text plus natural dimensions.
 *   - draw(): the main live-preview renderer — applies every current
 *     designer setting to the on-screen HTML/CSS token preview,
 *     including which of #nameDisplay / #nameDisplayOutside is shown
 *     for the Unit Label based on selectedLabelPosition.
 *   - buildDesignerConfig(): snapshots all current designer settings
 *     into a plain config object, the same shape consumed by the
 *     canvas and SVG export engines.
 *   - savePrefs() / loadPrefs(): persist the designer's current
 *     theme, shape, colors, hierarchy/label position, format, font,
 *     and which collapsible panels (Background Image, Font) were
 *     left open to localStorage, and restore them on the next page
 *     load. The uploaded background image itself is intentionally
 *     NOT persisted, since it could be several MB of base64 and risk
 *     hitting the browser's localStorage quota — only its settings
 *     are.
 *   - Bootstrap: initializes the UI state (font buttons, library
 *     counters), restores saved preferences, and performs the
 *     initial draw so the designer is perfectly synced on load.
 * ---------------------------------------------------------------------
 */

function toggleTheme() {
    const isDark = document.body.classList.toggle('dm');
    document.getElementById('themeToggle').innerText = isDark ? 'LIGHT' : 'DARK';
    savePrefs();
}

function setShape(shape) {
    selectedShape = shape;
    document.querySelectorAll('#shapeToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.shape === shape));
    draw();
}

function setPosition(pos) {
    selectedPosition = pos;
    document.querySelectorAll('#positionToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.pos === pos));
    draw();
}

function setLabelPosition(pos) {
    selectedLabelPosition = pos;
    document.querySelectorAll('#labelPositionToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.labelpos === pos));
    draw();
}

function setFormat(fmt) {
    selectedFormat = fmt;
    document.querySelectorAll('#formatToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.format === fmt));
    savePrefs();
}

function setFontSize(val) {
    fontSize = Math.min(100, Math.max(8, parseInt(val, 10)));
    draw();
}

function setFontFamily(font) {
    selectedFontFamily = font;
    document.querySelectorAll('.font-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.font === font);
    });
    draw();
}

function getFontFamily() {
    return selectedFontFamily || 'Arial';
}

function handleImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    const isSvg = /\.svg$/i.test(file.name) || file.type === 'image/svg+xml';
    uploadedImageIsSvg = isSvg;

    const reader = new FileReader();
    reader.onload = function(event) {
        uploadedImage = event.target.result;
        const dimProbe = new Image();
        dimProbe.onload = function() {
            uploadedImageNaturalW = dimProbe.naturalWidth;
            uploadedImageNaturalH = dimProbe.naturalHeight;
            draw();
        };
        dimProbe.src = uploadedImage;
    }
    reader.readAsDataURL(file);

    if (isSvg) {
        const textReader = new FileReader();
        textReader.onload = function(event) {
            uploadedImageSvgText = event.target.result;
        };
        textReader.readAsText(file);
    } else {
        uploadedImageSvgText = "";
    }

    e.target.value = '';
}

function draw() {
    const number = document.getElementById('inNumber').value;
    const hierarchy = document.getElementById('inHierarchy').value;
    const color = document.getElementById('inColor').value;
    const strokeColor = document.getElementById('inStrokeColor').value;
    const textColor = document.getElementById('inTextColor').value;
    const opacity = document.getElementById('inOpacity').value;
    const fontFamily = getFontFamily();

    const opacityValEl = document.getElementById('opacityVal');
    const fontSizeValEl = document.getElementById('fontSizeVal');
    if (opacityValEl) opacityValEl.innerText = opacity;
    if (fontSizeValEl) fontSizeValEl.innerText = fontSize + 'px';

    const mainShape = document.getElementById('mainShape');
    mainShape.className = "main-shape " + selectedShape;
    mainShape.style.backgroundColor = color;
    mainShape.style.borderColor = strokeColor;

    const hexOutline = document.getElementById('hexOutline');
    if (selectedShape === 'shape-hexagon') {
        hexOutline.style.display = 'block';
        hexOutline.querySelector('polygon').setAttribute('stroke', strokeColor);
    } else {
        hexOutline.style.display = 'none';
    }

    const hierarchyOutside = document.getElementById('hierarchyOutside');
    const hierarchyInside = document.getElementById('hierarchyInside');
    hierarchyOutside.innerText = hierarchy;
    hierarchyInside.innerText = hierarchy;
    hierarchyOutside.style.color = textColor;
    hierarchyInside.style.color = textColor;
    hierarchyOutside.style.fontFamily = fontFamily;
    hierarchyInside.style.fontFamily = fontFamily;
    hierarchyOutside.style.display = selectedPosition === 'outside' ? 'block' : 'none';
    hierarchyInside.style.display = selectedPosition === 'inside' ? 'block' : 'none';

    const nameDisplay = document.getElementById('nameDisplay');
    const nameDisplayOutside = document.getElementById('nameDisplayOutside');
    const labelFontSize = (fontSize * (250 / 350)) + 'px';

    nameDisplay.innerText = number;
    nameDisplay.style.color = textColor;
    nameDisplay.style.fontFamily = fontFamily;
    nameDisplay.style.fontSize = labelFontSize;
    nameDisplay.style.display = selectedLabelPosition === 'inside' ? 'block' : 'none';

    nameDisplayOutside.innerText = number;
    nameDisplayOutside.style.color = textColor;
    nameDisplayOutside.style.fontFamily = fontFamily;
    nameDisplayOutside.style.fontSize = labelFontSize;
    nameDisplayOutside.style.display = selectedLabelPosition === 'outside' ? 'block' : 'none';

    const zoom = parseFloat(document.getElementById('inImgZoom').value);
    const offX = parseFloat(document.getElementById('inImgOffsetX').value);
    const offY = parseFloat(document.getElementById('inImgOffsetY').value);
    
    const zoomValEl = document.getElementById('imgZoomVal');
    const offXValEl = document.getElementById('imgOffsetXVal');
    const offYValEl = document.getElementById('imgOffsetYVal');
    
    if (zoomValEl) zoomValEl.innerText = zoom.toFixed(2) + 'x';
    if (offXValEl) offXValEl.innerText = 'X:' + offX;
    if (offYValEl) offYValEl.innerText = 'Y:' + offY;

    const bgLayer = document.getElementById('bgLayer');
    if (uploadedImage) {
        bgLayer.style.backgroundImage = `url(${uploadedImage})`;
        bgLayer.style.opacity = opacity;
        if (uploadedImageNaturalW && uploadedImageNaturalH) {
            const boxSize = mainShape.clientWidth || 250;
            const geo = getCoverGeometry(uploadedImageNaturalW, uploadedImageNaturalH, boxSize, boxSize, zoom, offX, offY);
            bgLayer.style.backgroundSize = geo.width + 'px ' + geo.height + 'px';
            bgLayer.style.backgroundPosition = geo.x + 'px ' + geo.y + 'px';
        }
    }

    savePrefs();
}

function buildDesignerConfig() {
    return {
        shape: selectedShape,
        position: selectedPosition,
        labelPosition: selectedLabelPosition,
        color: document.getElementById('inColor').value,
        strokeColor: document.getElementById('inStrokeColor').value,
        textColor: document.getElementById('inTextColor').value,
        hierarchy: document.getElementById('inHierarchy').value,
        number: document.getElementById('inNumber').value,
        opacity: document.getElementById('inOpacity').value,
        fontFamily: getFontFamily(),
        fontSize: fontSize,
        imgZoom: parseFloat(document.getElementById('inImgZoom').value) || 1,
        imgOffsetX: parseFloat(document.getElementById('inImgOffsetX').value) || 0,
        imgOffsetY: parseFloat(document.getElementById('inImgOffsetY').value) || 0,
        image: uploadedImage,
        imgW: uploadedImageNaturalW,
        imgH: uploadedImageNaturalH,
        assetType: uploadedImage ? (uploadedImageIsSvg ? 'svg' : 'raster') : null,
        assetSvgText: uploadedImageSvgText
    };
}

function savePrefs() {
    try {
        const imageDetailsEl = document.getElementById('imageDetails');
        const fontDetailsEl = document.getElementById('fontDetails');
        const prefs = {
            theme: document.body.classList.contains('dm') ? 'dark' : 'light',
            shape: selectedShape,
            position: selectedPosition,
            labelPosition: selectedLabelPosition,
            format: selectedFormat,
            fontFamily: selectedFontFamily,
            fontSize: fontSize,
            hierarchy: document.getElementById('inHierarchy').value,
            number: document.getElementById('inNumber').value,
            color: document.getElementById('inColor').value,
            strokeColor: document.getElementById('inStrokeColor').value,
            textColor: document.getElementById('inTextColor').value,
            opacity: document.getElementById('inOpacity').value,
            imgZoom: document.getElementById('inImgZoom').value,
            imgOffsetX: document.getElementById('inImgOffsetX').value,
            imgOffsetY: document.getElementById('inImgOffsetY').value,
            imageDetailsOpen: imageDetailsEl ? imageDetailsEl.open : false,
            fontDetailsOpen: fontDetailsEl ? fontDetailsEl.open : false
        };
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch (err) {
    }
}

function loadPrefs() {
    let prefs = null;
    try {
        const raw = localStorage.getItem(PREFS_STORAGE_KEY);
        if (raw) prefs = JSON.parse(raw);
    } catch (err) {
        prefs = null;
    }
    if (!prefs) return;

    if (prefs.theme === 'dark') {
        document.body.classList.add('dm');
        document.getElementById('themeToggle').innerText = 'LIGHT';
    }

    if (prefs.shape) selectedShape = prefs.shape;
    if (prefs.position) selectedPosition = prefs.position;
    if (prefs.labelPosition) selectedLabelPosition = prefs.labelPosition;
    if (prefs.format) selectedFormat = prefs.format;
    if (prefs.fontFamily) selectedFontFamily = prefs.fontFamily;
    if (prefs.fontSize) fontSize = parseInt(prefs.fontSize, 10) || fontSize;

    if (prefs.hierarchy !== undefined) document.getElementById('inHierarchy').value = prefs.hierarchy;
    if (prefs.number !== undefined) document.getElementById('inNumber').value = prefs.number;
    if (prefs.color) document.getElementById('inColor').value = prefs.color;
    if (prefs.strokeColor) document.getElementById('inStrokeColor').value = prefs.strokeColor;
    if (prefs.textColor) document.getElementById('inTextColor').value = prefs.textColor;
    if (prefs.opacity !== undefined) document.getElementById('inOpacity').value = prefs.opacity;
    if (prefs.imgZoom !== undefined) document.getElementById('inImgZoom').value = prefs.imgZoom;
    if (prefs.imgOffsetX !== undefined) document.getElementById('inImgOffsetX').value = prefs.imgOffsetX;
    if (prefs.imgOffsetY !== undefined) document.getElementById('inImgOffsetY').value = prefs.imgOffsetY;
    document.getElementById('inFontSize').value = fontSize;

    document.querySelectorAll('#shapeToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.shape === selectedShape));
    document.querySelectorAll('#positionToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.pos === selectedPosition));
    document.querySelectorAll('#labelPositionToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.labelpos === selectedLabelPosition));
    document.querySelectorAll('#formatToggle .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.format === selectedFormat));

    const imageDetailsEl = document.getElementById('imageDetails');
    const fontDetailsEl = document.getElementById('fontDetails');
    if (imageDetailsEl && typeof prefs.imageDetailsOpen === 'boolean') imageDetailsEl.open = prefs.imageDetailsOpen;
    if (fontDetailsEl && typeof prefs.fontDetailsOpen === 'boolean') fontDetailsEl.open = prefs.fontDetailsOpen;
}

const countEl = document.getElementById('assetCount');
if (countEl) {
    countEl.innerText = `(${libraryCache.size})`;
}

loadPrefs();
setFontFamily(selectedFontFamily);

draw();
