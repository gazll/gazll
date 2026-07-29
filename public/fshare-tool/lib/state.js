/* Shared mutable state.

   Every module reads and writes through this one object rather than importing
   each other's variables. ES module bindings are read-only at the import site,
   so a plain exported `let` could be read but never reassigned from a view —
   a single namespace object keeps that simple and keeps the import graph
   acyclic, which is what stops views and stores from importing in circles. */

/** Upstream serves a fixed page size and ignores any ?limit we send. */
export const PAGE_SIZE = 50;

/** Parallel folder fetches during a crawl. 6 measured clean against upstream. */
export const CONCURRENCY = 6;

/** Guards against pathological nesting and runaway crawls. */
export const MAX_DEPTH = 12;
export const MAX_FOLDERS = 4000;

/** Every option is a multiple of PAGE_SIZE, so a client page maps onto a whole
    number of upstream pages. 0 means "all". */
export const PER_PAGE_OPTS = [50, 100, 200, 500, 1000, 0];

/** Rows past this count switch the list to virtual scrolling. */
export const VIRTUAL_THRESHOLD = 120;

/** Fallback row height, in px. The scroller prefers --row-h, then a real row. */
export const ROW_HEIGHT = 46;

export const HIST_MAX = 60;

export const S = {
  /* navigation */
  navStack: [],          // [{linkcode, name}]
  currentPage: 1,
  totalPages: 1,
  pageItems: [],         // items rendered by the table view

  /* tree cache: linkcode -> {lc,name,items,loaded,loading,expanded,error} */
  nodes: new Map(),
  treeRoot: null,
  quietRender: false,    // suppress repaints during a bulk expand

  /* settings */
  viewMode: 'tree',
  perPage: 100,
  chunkSize: 49,
  sortValue: 'type,name',

  /* filtering + range selection */
  filterText: '',
  displayList: [],       // items currently on screen, in visual order
  lastPickIdx: -1
};

export const $ = (id) => document.getElementById(id);
