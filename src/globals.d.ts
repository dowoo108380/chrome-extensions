/**
 * Project-specific browser declarations. Chrome APIs use the pinned @types/chrome
 * package; no runtime compatibility shim is emitted.
 */
declare function importScripts(...urls: string[]): void;


interface TextTrackCue {
  text?: string;
}

/** The caption overlay owns this isolated-world sentinel; no page-world state is declared. */
declare var __browserToolboxYouTubeSyncedCaptionOverlayV1__: {
  scheduleTrackScan(): void;
  scheduleOverlayRender(): void;
} | undefined;
