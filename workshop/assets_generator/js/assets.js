/*
 * ASSETS.JS
 * ---------------------------------------------------------------------
 * Manages the in-memory library of assets (flags/images) used by Mass
 * Production. Handles the bulk upload of files, stores them in the
 * global libraryCache (Map), and provides a resolution mechanism to
 * retrieve assets by their exact filename. Also handles the UI
 * rendering of the library modal for asset management and
 * verification.
 *
 * Contains:
 *   - promptLibrary(): triggers the hidden library file input.
 *   - handleLibraryUpload(): processes multiple uploaded files,
 *     detects if they are SVG or raster, and merges them into the
 *     existing cache (same-named files overwrite, since that is the
 *     expected "replace this asset" behavior).
 *   - fileToDataUrl(): converts a File object to a base64 data URL.
 *   - blobToDataUrl(): converts a Blob object to a base64 data URL.
 *   - renderAssetGrid(): populates the modal grid with thumbnails and
 *     metadata (name, size) for all currently cached assets.
 *   - resolveAsset(): looks up a specific asset in the cache by its
 *     exact filename (including extension).
 *   - openAssetModal() / closeAssetModal(): UI visibility controls
 *     for the asset management modal.
 * ---------------------------------------------------------------------
 */

function promptLibrary() {
    document.getElementById('inLibraryFolder').click();
}

async function handleLibraryUpload(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
        const name = file.name;
        const isSvg = name.toLowerCase().endsWith('.svg');
        const size = (file.size / 1024).toFixed(1) + " KB";

        if (isSvg) {
            const text = await file.text();
            libraryCache.set(name, { type: 'svg', content: text, size: size });
        } else {
            const dataUrl = await fileToDataUrl(file);
            libraryCache.set(name, { type: 'raster', content: dataUrl, size: size });
        }
    }

    const countEl = document.getElementById('assetCount');
    if (countEl) countEl.innerText = `(${libraryCache.size})`;
    
    renderAssetGrid();
    event.target.value = '';
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function renderAssetGrid() {
    const grid = document.getElementById('assetGrid');
    if (!grid) return;
    grid.innerHTML = "";

    libraryCache.forEach((asset, name) => {
        const item = document.createElement('div');
        item.className = 'asset-item';
        
        const img = document.createElement('img');
        if (asset.type === 'svg') {
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(asset.content)));
        } else {
            img.src = asset.content;
        }
        
        const info = document.createElement('div');
        info.style.marginTop = "5px";
        info.innerHTML = `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:bold" title="${name}">${name}</div><div style="opacity:0.6">${asset.size}</div>`;
        
        item.appendChild(img);
        item.appendChild(info);
        grid.appendChild(item);
    });
}

async function resolveAsset(fileNameWithExt) {
    if (!fileNameWithExt) return null;
    
    if (libraryCache.has(fileNameWithExt)) {
        return libraryCache.get(fileNameWithExt);
    }
    
    return null;
}

function openAssetModal() {
    document.getElementById('assetModal').style.display = 'flex';
}

function closeAssetModal(e) {
    document.getElementById('assetModal').style.display = 'none';
}
