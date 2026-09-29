/**
 * Minimal compile-time declarations for Chrome extension globals.
 * Runtime behavior is provided by Chrome; no compatibility shim is emitted.
 */
declare var chrome: any;
declare function importScripts(...urls: string[]): void;


interface TextTrackCue {
  text?: string;
}

/** The caption overlay owns this isolated-world sentinel; no page-world state is declared. */
declare var __browserToolboxYouTubeSyncedCaptionOverlayV1__: {
  scheduleTrackScan(): void;
  scheduleOverlayRender(): void;
} | undefined;
