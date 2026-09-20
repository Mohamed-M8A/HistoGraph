// ==========================================================================
// DOWNLOAD HELPER
//
// Generic utility to trigger a browser download for any Blob. Used by
// controller/battleRecorder.js to save recorded footage, but has no
// dependency on recording, the simulation, or any other domain concept -
// it only knows about Blobs and filenames, so it belongs in utils/ next
// to colorUtils.js rather than in controller/.
//
// Split out of the old monolithic Controller.js.
// ==========================================================================

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
