// ==========================================================================
// BATTLE RECORDER
//
// Captures the simulation canvas as a video stream (via
// canvas.captureStream) and records it into a WebM blob using
// MediaRecorder. Falls back to plain "video/webm" if VP9 isn't
// supported by the browser.
//
// Split out of the old monolithic Controller.js: BattleRecorder only
// needs a canvas reference, nothing from Clock or SimulationController.
// ==========================================================================

export class BattleRecorder {
  constructor(canvas, fps = 30) {
    this.canvas = canvas;
    this.fps = fps;
    this.recorder = null;
    this.chunks = [];
    this.recording = false;
  }

  start() {
    if (this.recording) return;
    const stream = this.canvas.captureStream(this.fps);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType });
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.recording = true;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recording || !this.recorder) {
        resolve(null);
        return;
      }
      this.recorder.onstop = () => {
        this.recording = false;
        resolve(new Blob(this.chunks, { type: "video/webm" }));
      };
      this.recorder.stop();
    });
  }

  isRecording() {
    return this.recording;
  }
}
