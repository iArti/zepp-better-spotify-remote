import { BaseApp } from "@zeppos/zml/base-app";
import { localStorage } from "@zos/storage";
import { getThumbs } from "./shared/thumbs";

App(
  BaseApp({
    globalData: {
      // Last known player state (also persisted, so pages render instantly)
      state: null,
      // Set by pages to get notified about received images
      onCover: null,
      onThumb: null,
      // Receives image files from the phone; see shared/files.js
      handleFile: null,
    },

    onCreate() {
      try {
        this.globalData.state = JSON.parse(localStorage.getItem("state", "null"));
      } catch (e) {
        this.globalData.state = null;
      }
      this.globalData.handleFile = (file) => this.handleFile(file);
    },

    // zml owns the TransferFile inbox and hands us each incoming file
    onReceivedFile(file) {
      this.handleFile(file);
    },

    handleFile(file) {
      if (!file) return;
      if (file.readyState === "transferred") {
        this.saveFile(file);
        return;
      }
      file.on("change", (event) => {
        if (event.data.readyState === "transferred") this.saveFile(file);
      });
    },

    saveFile(file) {
      let params = file.params || {};
      if (typeof params === "string") {
        try {
          params = JSON.parse(params);
        } catch (e) {
          params = {};
        }
      }

      if (params.kind === "thumb") {
        const thumbs = getThumbs();
        thumbs[params.id] = file.filePath;
        localStorage.setItem("thumbs", JSON.stringify(thumbs));
        if (this.globalData.onThumb) this.globalData.onThumb(params.id, file.filePath);
        return;
      }

      const coverId = params.coverId;
      console.log("cover received", file.filePath, coverId);
      localStorage.setItem("coverPath", file.filePath);
      localStorage.setItem("coverId", coverId || "");
      if (this.globalData.onCover) this.globalData.onCover(file.filePath, coverId);
    },

    onDestroy() {},
  })
);
