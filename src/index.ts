import { INITIALIZE_LOG } from "@constants";
import { initProviders } from "@modules/lyrics/providers/shared";
import { setupRequestSniffer } from "@modules/lyrics/requestSniffer/requestSniffer";
import { injectHeadTags, setupAdObserver } from "@modules/ui/dom";
import {
  enableLyricsTab,
  initializeLyrics,
  lyricReloader,
  setupOverlayKeyboardHandler,
} from "@modules/ui/observer";
import { log, setUpLog } from "@utils";

/**
 * Initializes the BetterLyrics extension by setting up all required components.
 * This method orchestrates the setup of logging, DOM injection, observers, settings,
 * storage, and lyric providers.
 */
async function modify(): Promise<void> {
  setUpLog();
  await injectHeadTags();
  setupAdObserver();
  enableLyricsTab();
  lyricReloader();
  initializeLyrics();
  setupOverlayKeyboardHandler();
  initProviders();
  log(
    INITIALIZE_LOG,
    "background: rgba(10,11,12,1) ; color: rgba(214, 250, 214,1) ; padding: 0.5rem 0.75rem; border-radius: 0.5rem; font-size: 1rem; "
  );
}

/**
 * Initializes the application by setting up the DOM content loaded event listener.
 * Entry point for the BetterLyrics extension.
 */
function init(): void {
  document.addEventListener("DOMContentLoaded", modify);
}

// Initialize the application
init();

setupRequestSniffer();
