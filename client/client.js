/**
 * dsh-llm-memory client half (classic browser module).
 *
 * Registered through the dsh module loader: a conversation View that renders the
 * memory WebUI directly inside the dsh shell (no iframe) and the settings card
 * for the plugin namespace. The UI consumes the dsh design tokens (`--dsw-*`),
 * so it follows the light/dark theme and reads as part of the harness.
 * All UI text is English.
 *
 * Authoritative source: build copies this file to `lib/client.js`
 * (see scripts/copy-client.mjs). Kept as plain classic JS on purpose — the dsh
 * client has no bundler for third-party plugin clients.
 */
window.__ModuleLoader__.load({
  id: "dsh-llm-memory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;

    const NAMESPACE = "dsh-llm-memory";
    const DEFAULT_WEB_PATH = "/llm-memory";
    const VIEW_LABEL = "LLM Memory";
    const VIEW_ID = "llm-memory";
    const ORDER = 30;
    const PREVIEW_TEXT_LIMIT = 20000;
    const GRAPH_HEIGHT = 520;

    const inject = ["slots", "configForms"];

    const KINDS = ["rules", "preferences", "decisions", "facts", "architecture", "concepts"];
    /** Screens of the universal schema this view renders (settings has its own slot). */
    const DSH_VIEW_IDS = ["overview", "items", "editor", "graph", "map", "recall", "health"];

    /* ------------------------------------------------------------------ *
     * helpers
     * ------------------------------------------------------------------ */

    function normalizeBase(value) {
      let raw = typeof value === "string" ? value.trim() : "";
      if (raw.length === 0) raw = DEFAULT_WEB_PATH;
      if (raw.charAt(0) !== "/") raw = "/" + raw;
      raw = raw.replace(/\/+$/, "");
      return raw.length === 0 ? DEFAULT_WEB_PATH : raw;
    }

    function webBase(scope) {
      let snapshot = null;
      try {
        snapshot = scope && typeof scope.getSnapshot === "function" ? scope.getSnapshot() : null;
      } catch (error) {
        snapshot = null;
      }
      const value = snapshot && snapshot.value ? snapshot.value : null;
      return normalizeBase(value ? value.webPath : undefined);
    }

    function joinUrl(base, path) {
      return String(base).replace(/\/+$/, "") + path;
    }

    function errorText(error) {
      return error && error.message ? error.message : String(error);
    }

    async function readJson(response) {
      const text = await response.text();
      let data = null;
      try {
        data = text.length > 0 ? JSON.parse(text) : null;
      } catch (error) {
        data = null;
      }
      if (!response.ok) {
        throw new Error((data && data.error) || "Request failed with status " + response.status);
      }
      return data || {};
    }

    function apiGet(base, path) {
      return fetch(joinUrl(base, path), { headers: { Accept: "application/json" } }).then(readJson);
    }

    function apiPost(base, path, body) {
      return fetch(joinUrl(base, path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      }).then(readJson);
    }

    function intValue(value, fallback, min, max) {
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      const rounded = Math.round(parsed);
      if (rounded < min) return min;
      if (rounded > max) return max;
      return rounded;
    }

    function floatValue(value, fallback, min, max) {
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      if (parsed < min) return min;
      if (parsed > max) return max;
      return parsed;
    }

    function oneOf(value, allowed, fallback) {
      const text = String(value);
      return allowed.indexOf(text) >= 0 ? text : fallback;
    }

    function truncatePreview(value) {
      const text = String(value == null ? "" : value);
      if (text.length <= PREVIEW_TEXT_LIMIT) return text;
      return text.slice(0, PREVIEW_TEXT_LIMIT) + "\n\u2026 truncated, " + text.length + " chars total";
    }

    function splitList(value) {
      return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    function datePart(value) {
      return String(value || "").slice(0, 10);
    }

    function toForm(value) {
      const v = value && typeof value === "object" ? value : {};
      return {
        storageRoot: typeof v.storageRoot === "string" ? v.storageRoot : "",
        recallLimit: String(typeof v.recallLimit === "number" ? v.recallLimit : 10),
        autonomous: v.autonomous !== false,
        requireConfirmation: v.requireConfirmation === true,
        systemPrompt: typeof v.systemPrompt === "string" ? v.systemPrompt : "",
        lintOverlapMinCommonWords: String(
          typeof v.lintOverlapMinCommonWords === "number" ? v.lintOverlapMinCommonWords : 8,
        ),
        lintMaxPairs: String(typeof v.lintMaxPairs === "number" ? v.lintMaxPairs : 200),
        recallTextChars: String(typeof v.recallTextChars === "number" ? v.recallTextChars : 400),
        recallTotalChars: String(typeof v.recallTotalChars === "number" ? v.recallTotalChars : 12000),
        recallFormat:
          v.recallFormat === "table" || v.recallFormat === "timeline" || v.recallFormat === "json"
            ? v.recallFormat
            : "markdown",
        recallAllowFormatOverride: v.recallAllowFormatOverride !== false,
        recallLiteralLookup: v.recallLiteralLookup !== false,
        promptRulesLimit: String(typeof v.promptRulesLimit === "number" ? v.promptRulesLimit : 6),
        rulesPromptScope: v.rulesPromptScope === "all" ? "all" : "project",
        projectScanBudgetMs: String(typeof v.projectScanBudgetMs === "number" ? v.projectScanBudgetMs : 0),
        embeddingsProvider:
          v.embeddingsProvider === "off" || v.embeddingsProvider === "http" ? v.embeddingsProvider : "local",
        embeddingsModel:
          typeof v.embeddingsModel === "string" && v.embeddingsModel.length > 0
            ? v.embeddingsModel
            : "Xenova/multilingual-e5-small",
        embeddingsDim: String(typeof v.embeddingsDim === "number" ? v.embeddingsDim : 384),
        embeddingsBackend:
          v.embeddingsBackend === "off" || v.embeddingsBackend === "sqlite-vec" ? v.embeddingsBackend : "js",
        embeddingsQuantization:
          v.embeddingsQuantization === "int8" || v.embeddingsQuantization === "bit"
            ? v.embeddingsQuantization
            : "float",
        embeddingsTopK: String(typeof v.embeddingsTopK === "number" ? v.embeddingsTopK : 50),
        embeddingsMinScore: String(typeof v.embeddingsMinScore === "number" ? v.embeddingsMinScore : 0),
        embeddingsBatchSize: String(typeof v.embeddingsBatchSize === "number" ? v.embeddingsBatchSize : 16),
        embeddingsChunkChars: String(typeof v.embeddingsChunkChars === "number" ? v.embeddingsChunkChars : 800),
        embeddingsChunkOverlap: String(
          typeof v.embeddingsChunkOverlap === "number" ? v.embeddingsChunkOverlap : 120,
        ),
        embeddingsSemanticEdgesPerEntry: String(
          typeof v.embeddingsSemanticEdgesPerEntry === "number" ? v.embeddingsSemanticEdgesPerEntry : 3,
        ),
        embeddingsSemanticMaxEdges: String(
          typeof v.embeddingsSemanticMaxEdges === "number" ? v.embeddingsSemanticMaxEdges : 300,
        ),
        embeddingsPrewarm: v.embeddingsPrewarm !== false,
        webPath: typeof v.webPath === "string" && v.webPath.length > 0 ? v.webPath : DEFAULT_WEB_PATH,
      };
    }

    function unavailableScope() {
      const snapshot = {
        status: "unavailable",
        value: undefined,
        base: undefined,
        user: undefined,
        revision: undefined,
        writable: false,
        mode: "memory",
      };
      const rejected = () => Promise.reject(new Error("The dsh settings service is unavailable."));
      return {
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
        set: rejected,
        unset: rejected,
        mutate: rejected,
      };
    }

    /* ------------------------------------------------------------------ *
     * design tokens
     *
     * Everything below reads the dsh palette tokens with neutral fallbacks for
     * hosts that do not define them, so the same components work in the shell
     * and in the standalone page.
     * ------------------------------------------------------------------ */

    const T = {
      text: "var(--dsw-alias-label-primary, inherit)",
      secondary: "var(--dsw-alias-label-secondary, rgba(127,127,127,0.95))",
      tertiary: "var(--dsw-alias-label-tertiary, rgba(127,127,127,0.78))",
      caption: "var(--dsw-alias-label-caption, rgba(127,127,127,0.62))",
      bg1: "var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))",
      bg2: "var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))",
      bg3: "var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.14))",
      border1: "var(--dsw-alias-border-l1, rgba(127,127,127,0.24))",
      border2: "var(--dsw-alias-border-l2, rgba(127,127,127,0.36))",
      hover: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14))",
      link: "var(--dsw-alias-link, #4176e6)",
      business: "var(--dsw-alias-state-business-primary, #4176e6)",
      success: "var(--dsw-alias-state-success-primary, #22c55e)",
      warn: "var(--dsw-alias-state-warn-primary, #f59e0b)",
      danger: "var(--dsw-alias-state-error-primary, #ec1313)",
      menu: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-3, rgba(40,40,40,0.98)))",
      elevation: "var(--dsw-elevation-prominent, 0 3px 8px rgba(0,0,0,0.18))",
      mask: "var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.45))",
      code: "var(--dsw-alias-markdown-code-block, rgba(127,127,127,0.12))",
      mono: "var(--dsw-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
      surface: "var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))",
      accent: "var(--dsw-alias-state-business-primary, #4176e6)",
      radius: "12px",
      radiusSm: "8px",
    };

    const KIND_COLORS = {
      rules: T.danger,
      preferences: T.warn,
      decisions: T.business,
      facts: T.success,
      architecture: T.link,
      concepts: T.tertiary,
    };

    const EDGE_COLORS = {
      supersedes: T.danger,
      related: T.business,
      depends: T.warn,
      contradicts: T.link,
    };

    const S = {
      root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: "420px",
        overflow: "hidden",
        color: T.text,
        font: "inherit",
        background: "transparent",
      },
      toolbar: {
        display: "flex",
        flexWrap: "wrap",
        gap: "10px",
        alignItems: "center",
        padding: "14px 18px 4px",
        flex: "0 0 auto",
      },
      toolbarSpacer: { flex: "1 1 auto" },
      status: { fontSize: "12.5px", color: T.secondary, whiteSpace: "pre-wrap" },
      viewTitle: { fontSize: "15px", fontWeight: 650, letterSpacing: "-0.01em", color: T.text, lineHeight: 1.2 },
      viewSub: { fontSize: "11.5px", color: T.caption, marginTop: "2px" },
      tabs: {
        display: "flex",
        flexWrap: "wrap",
        gap: "4px",
        padding: "0 18px 12px",
        borderBottom: "1px solid " + T.border1,
        flex: "0 0 auto",
      },
      tab: {
        background: "transparent",
        color: T.secondary,
        border: "1px solid transparent",
        borderRadius: T.radiusSm,
        padding: "6px 12px",
        fontSize: "12.5px",
        cursor: "pointer",
        font: "inherit",
      },
      tabActive: {
        background: T.bg2,
        color: T.accent,
        border: "1px solid " + T.border1,
        borderRadius: T.radiusSm,
        padding: "6px 12px",
        fontSize: "12.5px",
        fontWeight: 600,
        cursor: "pointer",
        font: "inherit",
      },
      content: {
        flex: "1 1 auto",
        overflow: "auto",
        padding: "16px 18px 24px",
        width: "100%",
        maxWidth: "1240px",
        margin: "0 auto",
        boxSizing: "border-box",
      },
      input: {
        background: T.bg1,
        color: T.text,
        border: "1px solid " + T.border1,
        borderRadius: T.radiusSm,
        padding: "0 10px",
        height: "32px",
        fontSize: "12.5px",
        minWidth: "120px",
        font: "inherit",
        boxSizing: "border-box",
      },
      option: { background: T.menu, color: T.text },
      button: {
        background: T.bg1,
        color: T.text,
        border: "1px solid " + T.border1,
        borderRadius: T.radiusSm,
        padding: "0 11px",
        height: "30px",
        fontSize: "12.5px",
        cursor: "pointer",
        font: "inherit",
      },
      primary: {
        background: T.business,
        color: "#ffffff",
        border: "1px solid transparent",
        borderRadius: T.radiusSm,
        padding: "0 11px",
        height: "30px",
        fontSize: "12.5px",
        fontWeight: 550,
        cursor: "pointer",
        font: "inherit",
      },
      danger: {
        background: "transparent",
        color: T.danger,
        border: "1px solid " + T.danger,
        borderRadius: T.radiusSm,
        padding: "0 11px",
        height: "30px",
        fontSize: "12.5px",
        cursor: "pointer",
        font: "inherit",
      },
      disabled: { opacity: 0.5, cursor: "not-allowed" },
      field: { display: "flex", flexDirection: "column", gap: "5px", marginBottom: "12px" },
      label: { fontSize: "12.5px", fontWeight: 550, color: T.secondary },
      hint: { fontSize: "11.5px", color: T.caption, lineHeight: 1.45 },
      row: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-end" },
      actions: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "10px" },
      panel: {
        background: T.bg1,
        border: "1px solid " + T.border1,
        borderRadius: T.radius,
        padding: "16px",
        marginBottom: "14px",
      },
      card: {
        background: T.bg1,
        border: "1px solid " + T.border1,
        borderRadius: T.radius,
        padding: "14px",
      },
      grid: {
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: "8px",
      },
      cardTitle: { margin: "0 0 3px", fontSize: "13.5px", fontWeight: 600, color: T.text },
      meta: { fontSize: "11.5px", color: T.caption, wordBreak: "break-all", marginBottom: "6px" },
      pills: { display: "flex", gap: "5px", flexWrap: "wrap", margin: "6px 0" },
      pill: {
        fontSize: "11px",
        border: "1px solid " + T.border2,
        borderRadius: "999px",
        padding: "1px 8px",
        color: T.secondary,
        whiteSpace: "nowrap",
      },
      text: {
        whiteSpace: "pre-wrap",
        maxHeight: "120px",
        overflow: "auto",
        fontSize: "12.5px",
        lineHeight: 1.55,
        color: T.secondary,
        margin: "8px 0 0",
      },
      kpis: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: "12px",
        marginBottom: "14px",
      },
      kpi: { background: T.bg1, border: "1px solid " + T.border1, borderRadius: T.radius, padding: "14px" },
      kpiNum: { fontSize: "26px", fontWeight: 650, letterSpacing: "-0.03em", color: T.text, marginTop: "4px" },
      kpiLabel: { fontSize: "12px", color: T.secondary },
      sectionTitle: { margin: "16px 0 8px", fontSize: "13.5px", fontWeight: 600, color: T.text },
      bars: { display: "grid", gap: "5px" },
      bar: { display: "grid", gridTemplateColumns: "120px 1fr 40px", gap: "8px", alignItems: "center", fontSize: "12px" },
      barTrack: { background: T.bg2, border: "1px solid " + T.border1, borderRadius: "999px", height: "8px", overflow: "hidden", display: "block" },
      barFill: { display: "block", minWidth: "2px", height: "100%", borderRadius: "5px", background: T.business },
      pre: {
        background: T.code,
        border: "1px solid " + T.border1,
        borderRadius: T.radiusSm,
        padding: "10px",
        overflow: "auto",
        maxHeight: "320px",
        whiteSpace: "pre-wrap",
        fontFamily: T.mono,
        fontSize: "11px",
        color: T.text,
        margin: 0,
      },
      list: { margin: "4px 0 8px", paddingLeft: "18px", fontSize: "12px", color: T.secondary },
      overlay: {
        position: "fixed",
        inset: 0,
        background: T.mask,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        zIndex: 60,
      },
      overlayBox: {
        background: T.bg3,
        color: T.text,
        border: "1px solid " + T.border1,
        borderRadius: "14px",
        boxShadow: T.elevation,
        maxWidth: "760px",
        width: "100%",
        maxHeight: "80vh",
        overflow: "auto",
        padding: "18px",
      },
      overlayTitle: { margin: "0 0 8px", fontSize: "15px", fontWeight: 600 },
      legend: { display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "8px", fontSize: "12px", color: T.secondary },
      legendDot: { display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", marginRight: "4px" },
      graphBox: { position: "relative" },
      graphSvg: {
        width: "100%",
        height: GRAPH_HEIGHT + "px",
        background: T.bg1,
        border: "1px solid " + T.border1,
        borderRadius: T.radius,
        cursor: "grab",
        display: "block",
      },
      graphHint: {
        position: "absolute",
        right: "10px",
        bottom: "10px",
        fontSize: "11px",
        color: T.caption,
        background: T.bg2,
        border: "1px solid " + T.border1,
        borderRadius: "6px",
        padding: "3px 7px",
      },
      checkboxRow: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: T.text },
      cardColumn: {
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        maxWidth: "720px",
        color: T.text,
        font: "inherit",
      },
    };

    /* ------------------------------------------------------------------ *
     * shared design: prototype CSS is scoped to .lm-panel (build step)
     * ------------------------------------------------------------------ */

    const PANEL_CSS = typeof __LM_PANEL_CSS__ === "string" ? __LM_PANEL_CSS__ : "";
    const PANEL_EXTRA_CSS = [
      ".lm-panel{height:auto!important;min-height:100%;box-sizing:border-box;background:var(--bg);color:var(--text);font-family:var(--font);}",
      ".lm-panel .lm-top{display:flex;align-items:center;gap:8px;padding:12px 28px 0;}",
      ".lm-panel .lm-tabs{position:sticky;top:0;z-index:12;display:flex;flex-wrap:wrap;gap:2px;padding:8px 28px 0;border-bottom:1px solid var(--border);background:var(--bg);}",
      ".lm-panel .table th{position:static;}",
      ".lm-panel .lm-tab{height:34px;padding:0 12px;border:1px solid transparent;border-bottom:0;border-radius:8px 8px 0 0;background:transparent;color:var(--text-2);font:inherit;font-size:12.5px;cursor:pointer;}",
      ".lm-panel .lm-tab:hover{background:var(--surface-2);color:var(--text);}",
      ".lm-panel .lm-tab.active{background:var(--surface);border-color:var(--border);color:var(--accent);font-weight:600;margin-bottom:-1px;}",
      ".lm-panel .lm-top .btn{margin-left:auto;}",
      ".lm-panel .content{padding:22px 28px 56px;}",
      ".lm-panel .page-head{margin-bottom:18px;}",
      ".lm-panel .field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;min-width:0;}",
      ".lm-panel .field > .label{font-size:12px;font-weight:550;color:var(--text-2);}",
      ".lm-panel .field .hint{font-size:11.5px;color:var(--text-3);}",
      ".lm-panel .form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0 16px;}",
      ".lm-panel .form-grid .wide{grid-column:1/-1;}",
      ".lm-panel .actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px;}",
      ".lm-panel .notice{font-size:12.5px;color:var(--text-2);white-space:pre-wrap;}",
      ".lm-panel .notice.error{color:var(--danger);}",
      ".lm-panel .graph-box{position:relative;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);overflow:hidden;}",
      ".lm-panel .graph-svg{display:block;width:100%;height:520px;background:var(--surface);cursor:grab;}",
      ".lm-panel .graph-hint{position:absolute;right:10px;bottom:10px;font-size:11px;color:var(--text-3);background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:3px 7px;}",
      ".lm-panel .chips{display:flex;flex-wrap:wrap;gap:6px;}",
      ".lm-panel .tag{display:inline-flex;align-items:center;font-size:11.5px;color:var(--text-2);background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:2px 8px;}",
      ".lm-panel .issue-list{display:flex;flex-direction:column;gap:8px;margin-top:8px;}",
      ".lm-panel .issue{border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 11px;background:var(--surface-2);}",
      ".lm-panel .issue-title{font-size:12.5px;font-weight:550;}",
      ".lm-panel .issue-meta{font-size:11.5px;color:var(--text-3);margin-top:2px;}",
      ".lm-panel .report-section-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3);margin:14px 0 6px;}",
      ".lm-panel .metric-line{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px dashed var(--border);font-size:12.5px;}",
      ".lm-panel .metric-line:first-child{border-top:0;}",
      ".lm-panel .metric-line .v{font-variant-numeric:tabular-nums;font-weight:550;}",
      ".lm-panel .modal-backdrop{position:fixed;inset:0;background:var(--overlay);display:grid;place-items:center;padding:20px;z-index:80;}",
      ".lm-panel .modal{width:min(720px,100%);max-height:86vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-3);}",
      ".lm-panel .modal-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border);}",
      ".lm-panel .modal-title{margin:0;font-size:15px;font-weight:600;}",
      ".lm-panel .modal-body{padding:18px;}",
      ".lm-panel .modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--border);}",
      ".lm-panel .empty{padding:36px 18px;text-align:center;color:var(--text-3);}",
      ".lm-panel .empty-title{font-size:13px;font-weight:550;color:var(--text-2);}",
      ".lm-panel .empty-text{font-size:12px;margin-top:4px;}",
      ".lm-panel .loading{padding:24px 18px;font-size:12.5px;color:var(--text-3);}",
    ].join("\n");

    function injectPanelStyles() {
      if (typeof document === "undefined" || !document.head) return;
      if (document.getElementById("llm-memory-panel-styles")) return;
      const style = document.createElement("style");
      style.id = "llm-memory-panel-styles";
      style.textContent = PANEL_CSS + "\n" + PANEL_EXTRA_CSS;
      document.head.appendChild(style);
    }
    injectPanelStyles();

    function colorLuminance(value) {
      const text = String(value || "").trim();
      if (!text) return null;
      let rgb = null;
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
      if (hex) {
        const raw = hex[1].length === 3 ? hex[1].split("").map((part) => part + part).join("") : hex[1];
        rgb = [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
      } else {
        const match = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(text);
        if (match) rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
      }
      if (!rgb) return null;
      return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    }

    function readShellTheme() {
      if (typeof document === "undefined") return "light";
      try {
        const html = document.documentElement;
        const declared = html.getAttribute("data-theme") || (document.body && document.body.getAttribute("data-theme"));
        if (declared === "dark" || declared === "light") return declared;
        const style = getComputedStyle(html);
        const scheme = style.colorScheme;
        if (scheme === "dark" || scheme === "light") return scheme;
        // The shell themes itself through --dsw-* tokens; layer-1 is the card
        // surface every panel sits on, so its luminance is the honest signal.
        for (const token of ["--dsw-alias-bg-layer-1", "--dsw-alias-bg-base", "--dsw-alias-label-primary"]) {
          const value = style.getPropertyValue(token).trim();
          const luminance = colorLuminance(value);
          if (luminance !== null) return luminance < 128 ? "dark" : "light";
        }
        const background = getComputedStyle(document.body || html).backgroundColor;
        const luminance = colorLuminance(background);
        if (luminance !== null) return luminance < 128 ? "dark" : "light";
      } catch (error) {
        /* fall through to the media query */
      }
      return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    function useShellTheme() {
      const [theme, setTheme] = React.useState(readShellTheme);
      React.useEffect(() => {
        if (typeof document === "undefined") return undefined;
        const update = () => setTheme(readShellTheme());
        const observer = new MutationObserver(update);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
        if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
        const media = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;
        if (media && media.addEventListener) media.addEventListener("change", update);
        update();
        return () => {
          observer.disconnect();
          if (media && media.removeEventListener) media.removeEventListener("change", update);
        };
      }, []);
      return theme;
    }

    function Btn(props) {
      const classes = ["btn"];
      if (props.variant) classes.push("btn-" + props.variant);
      if (props.size) classes.push("btn-" + props.size);
      return h(
        "button",
        {
          type: props.type || "button",
          className: classes.join(" "),
          title: props.title || undefined,
          disabled: props.disabled || false,
          onClick: props.onClick,
        },
        props.children,
      );
    }

    function PageHead({ title, sub, actions }) {
      return h(
        "div",
        { className: "page-head" },
        h("div", { className: "grow" }, h("h1", { className: "page-title" }, title), sub ? h("p", { className: "page-sub" }, sub) : null),
        actions ? h("div", { className: "page-actions" }, actions) : null,
      );
    }

    function Card({ title, sub, actions, body, foot, flush, className }) {
      const classes = ["card"];
      if (className) classes.push(className);
      return h(
        "section",
        { className: classes.join(" ") },
        title || actions
          ? h(
              "div",
              { className: "card-head" },
              h("div", { className: "grow" }, title ? h("h2", { className: "card-title" }, title) : null, sub ? h("p", { className: "card-sub" }, sub) : null),
              actions ? h("div", { className: "flex items-center gap-8" }, actions) : null,
            )
          : null,
        body ? h("div", { className: flush ? "card-body flush" : "card-body" }, body) : null,
        foot ? h("div", { className: "card-foot" }, foot) : null,
      );
    }

    function Stat({ label, value, hint }) {
      return h(
        "div",
        { className: "stat" },
        h("div", { className: "stat-top" }, h("span", { className: "stat-label" }, label)),
        h("div", { className: "stat-value" }, value === undefined || value === null ? "\u2014" : String(value)),
        hint ? h("div", { className: "stat-hint" }, hint) : null,
      );
    }

    function Badge({ tone, children }) {
      return h("span", { className: "badge" + (tone ? " badge-" + tone : "") }, children);
    }

    function Chip({ tone, children, onClick }) {
      if (onClick) return h("button", { type: "button", className: "chip" + (tone ? " " + tone : ""), onClick }, children);
      return h("span", { className: "chip" + (tone ? " " + tone : "") }, children);
    }

    function Empty({ title, text, action }) {
      return h(
        "div",
        { className: "empty" },
        h("div", { className: "empty-title" }, title || "Nothing here"),
        text ? h("p", { className: "empty-text" }, text) : null,
        action ? h("div", { className: "mt-12" }, action) : null,
      );
    }

    function Loading({ text }) {
      return h("div", { className: "loading" }, text || "Loading\u2026");
    }

    function Pager({ page, pageSize, total, pageSizes, onPage, onPageSize }) {
      const pages = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)));
      const current = Math.min(Math.max(1, page), pages);
      const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
      const to = Math.min(current * pageSize, total);
      return h(
        "div",
        { className: "table-foot" },
        h("div", { className: "table-info" }, "Showing " + from + "\u2013" + to + " / " + (total || 0)),
        h(
          "div",
          { className: "flex items-center gap-12" },
          pageSizes && pageSizes.length && onPageSize
            ? h(
                "label",
                { className: "page-size" },
                "Per page",
                h(
                  "select",
                  { className: "select", value: String(pageSize), onChange: (event) => onPageSize(Number(event.target.value)) },
                  pageSizes.map((size) => h("option", { key: size, value: String(size) }, String(size))),
                ),
              )
            : null,
          h(
            "div",
            { className: "pager" },
            h(Btn, { size: "sm", variant: "ghost", disabled: current <= 1, onClick: () => onPage && onPage(current - 1) }, "\u2039"),
            h("span", { className: "table-info" }, current + " / " + pages),
            h(Btn, { size: "sm", variant: "ghost", disabled: current >= pages, onClick: () => onPage && onPage(current + 1) }, "\u203a"),
          ),
        ),
      );
    }

    function DataTable({ columns, rows, onRow, renderCell, empty }) {
      if (!rows || rows.length === 0) return h(Empty, empty || { title: "No entries" });
      return h(
        "div",
        { className: "table-wrap" },
        h(
          "table",
          { className: "table" },
          h("thead", null, h("tr", null, columns.map((column) => h("th", { key: column.path, scope: "col" }, column.label || column.path)))),
          h(
            "tbody",
            null,
            rows.map((row) =>
              h(
                "tr",
                {
                  key: row.id,
                  className: onRow ? "clickable" : "",
                  tabIndex: onRow ? 0 : undefined,
                  onClick: onRow ? () => onRow(row) : undefined,
                  onKeyDown: onRow
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRow(row);
                        }
                      }
                    : undefined,
                },
                columns.map((column) =>
                  h("td", { key: column.path, className: column.path === "title" ? "cell-title" : "" }, renderCell ? renderCell(row, column) : defaultCell(column, row)),
                ),
              ),
            ),
          ),
        ),
      );
    }

    function defaultCell(column, row) {
      const value = row[column.path];
      if (column.path === "title") {
        return h("div", null, h("div", { className: "t" }, value || "(untitled)"), h("div", { className: "s" }, row.id || ""));
      }
      if (column.path === "kind" && value) return h(Badge, { tone: KIND_TONES[value] || "" }, value);
      if (column.path === "tier" && value) return h(Badge, { tone: value === "immutable" ? "danger" : value === "important" ? "warn" : "" }, value);
      if (column.path === "status" && value) return h(Badge, { tone: value === "active" ? "ok" : value === "deleted" ? "danger" : "" }, value);
      if (column.path === "tags") return (value || []).join(", ") || "\u2014";
      if (column.path === "updatedAt" || column.path === "createdAt") return datePart(value);
      if (value === undefined || value === null || value === "") return "\u2014";
      return String(value);
    }

    const KIND_TONES = {
      rules: "danger",
      preferences: "warn",
      decisions: "accent",
      facts: "info",
      architecture: "ok",
      concepts: "",
    };

    const VIEW_SUBTITLES = {
      overview: "Memory at a glance: volume, categories and index state.",
      items: "Every entry with filters, sorting and paging.",
      editor: "Create or update one memory entry.",
      graph: "Links between entries and tags.",
      map: "Embedding space projected onto two axes.",
      recall: "What the agent would actually receive.",
      health: "Lint, self-healing and the semantic index.",
    };

    /* ------------------------------------------------------------------ *
     * shared presentational pieces
     * ------------------------------------------------------------------ */


    /**
     * Actions the core schema exposes to panels (backup/model/lint/heal/...).
     * Buttons are rendered from this registry, so a new action appears in the
     * dsh panel without any client-side list to edit.
     */
    function useUIActions(source) {
      const base = typeof source === "string" ? source : webBase(source);
      const [actions, setActions] = React.useState([]);
      React.useEffect(() => {
        let alive = true;
        fetch(base + "/api/ui/snapshot")
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => {
            if (!alive || !data || !Array.isArray(data.actions)) return;
            setActions(data.actions);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, [base]);
      const byId = React.useMemo(() => {
        const map = {};
        actions.forEach((action) => {
          map[action.id] = action;
        });
        return map;
      }, [actions]);
      return { actions, byId };
    }

    function Field(props) {
      return h(
        "div",
        { className: "field" + (props.wide ? " wide" : "") },
        props.label ? h("span", { className: "label" }, props.label) : null,
        props.children,
        props.hint ? h("small", { className: "hint" }, props.hint) : null,
      );
    }

    /** One Settings field holding a number. */

    /** One Settings field holding a value picked from a fixed list. */
    function selectField(form, update, key, label, hint, options) {
      return h(
        Field,
        { label, hint },
        h(
          "select",
          {
            style: S.input,
            value: form[key],
            onChange: (event) => update(key, event.target.value),
          },
          options.map(([value, text]) => h("option", { key: value, style: S.option, value }, text)),
        ),
      );
    }

    /** One checkbox row in Settings. */

    function Pill(props) {
      const style = props.tone ? Object.assign({}, S.pill, { color: props.tone, borderColor: props.tone }) : S.pill;
      return h("span", { style }, props.children);
    }

    function Kpi(props) {
      return h(
        "div",
        { style: S.kpi },
        h("div", { style: S.kpiLabel }, props.label),
        h("div", { style: S.kpiNum }, String(props.value)),
      );
    }

    function Bars(props) {
      const counts = props.counts || {};
      const entries = Object.keys(counts)
        .map((key) => [key, counts[key]])
        .sort((a, b) => b[1] - a[1]);
      let max = 1;
      entries.forEach((pair) => {
        if (pair[1] > max) max = pair[1];
      });
      return h("div", null, [
        h("h3", { key: "title", style: S.sectionTitle }, props.title),
        entries.length === 0
          ? h("p", { key: "empty", style: S.hint }, "none")
          : h(
              "div",
              { key: "bars", style: S.bars },
              entries.map((pair) =>
                h(
                  "div",
                  { key: pair[0], style: S.bar },
                  h("span", { style: { color: T.secondary, overflow: "hidden", textOverflow: "ellipsis" } }, pair[0]),
                  h(
                    "span",
                    { style: S.barTrack },
                    h("span", { style: Object.assign({}, S.barFill, { width: Math.round((pair[1] / max) * 100) + "%" }) }),
                  ),
                  h("span", { style: { color: T.secondary, textAlign: "right" } }, String(pair[1])),
                ),
              ),
            ),
      ]);
    }

    function Notice(props) {
      if (!props.text) return null;
      return h("p", { style: Object.assign({}, S.status, { color: props.error ? T.danger : T.secondary }) }, props.text);
    }

    /* ------------------------------------------------------------------ *
     * conversation.view — Search & Browse
     * ------------------------------------------------------------------ */

    function projectName(value) {
      const text = String(value || "").replace(/[\\/]+$/, "");
      const parts = text.split(/[\\/]/);
      return parts[parts.length - 1] || text;
    }

    function BrowseTab(props) {
      const [query, setQuery] = React.useState("");
      const [kind, setKind] = React.useState("");
      const [tier, setTier] = React.useState("");
      const [scope, setScope] = React.useState("");
      const [status, setStatus] = React.useState("");
      const [project, setProject] = React.useState("");
      const [sort, setSort] = React.useState("updated");
      const pagination = props.pagination || { pageSizes: [12, 24, 48, 96], defaultPageSize: 24 };
      const [pageSize, setPageSize] = React.useState(String(pagination.defaultPageSize));
      const [page, setPage] = React.useState(0);
      const [reload, setReload] = React.useState(0);
      const [items, setItems] = React.useState(null);
      const [total, setTotal] = React.useState(0);
      const [error, setError] = React.useState("");

      const resetFilters = () => {
        setQuery("");
        setKind("");
        setTier("");
        setScope("");
        setStatus("");
        setProject("");
        setSort("updated");
        setPage(0);
      };

      const load = React.useCallback(async () => {
        const params = new URLSearchParams();
        if (query.trim()) params.set("query", query.trim());
        if (kind) params.set("kind", kind);
        if (tier) params.set("tier", tier);
        if (scope) params.set("scope", scope);
        if (status) params.set("status", status);
        if (project.trim()) params.set("project", project.trim());
        params.set("sort", sort);
        params.set("limit", pageSize);
        params.set("offset", String(page * Number(pageSize)));
        setError("");
        try {
          const data = await apiGet(props.base, "/api/items?" + params.toString());
          setItems(data.items || []);
          setTotal(data.total || 0);
        } catch (err) {
          setItems(null);
          setError(errorText(err));
        }
      }, [props.base, query, kind, tier, scope, status, project, sort, pageSize, page]);

      React.useEffect(() => {
        load();
      }, [props.version, page, pageSize, reload, query, kind, tier, scope, status, project, sort]);

      const select = (value, setter, options, label, width) =>
        h(
          "select",
          {
            className: "select",
            style: width ? { width } : { width: "auto", minWidth: "120px" },
            value,
            "aria-label": label,
            onChange: (event) => {
              setter(event.target.value);
              setPage(0);
            },
          },
          options.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
        );

      const columns = [
        { path: "title", label: "Title" },
        { path: "kind", label: "Kind" },
        { path: "tier", label: "Tier" },
        { path: "scope", label: "Scope" },
        { path: "status", label: "Status" },
        { path: "updatedAt", label: "Updated" },
      ];

      const activeFilters = query || kind || tier || scope || status || project || sort !== "updated";

      return h(
        "div",
        { className: "page" },
        h(PageHead, {
          title: "Entries",
          sub: VIEW_SUBTITLES.items,
          actions: h(Btn, { variant: "primary", onClick: props.onNew }, "New entry"),
        }),
        h(
          "div",
          { className: "toolbar" },
          h(
            "div",
            { className: "input-wrap", style: { flex: "1 1 260px" } },
            h("input", {
              className: "input",
              type: "search",
              placeholder: "Search title, text, tags",
              value: query,
              onChange: (event) => {
                setQuery(event.target.value);
                setPage(0);
              },
              onKeyDown: (event) => {
                if (event.key === "Enter") load();
              },
            }),
          ),
          select(kind, setKind, [{ value: "", label: "All kinds" }].concat(KINDS.map((value) => ({ value, label: value }))), "Kind"),
          select(tier, setTier, [{ value: "", label: "All tiers" }, { value: "normal", label: "normal" }, { value: "important", label: "important" }, { value: "immutable", label: "immutable" }], "Tier"),
          select(scope, setScope, [{ value: "", label: "All scopes" }, { value: "project", label: "project" }, { value: "user", label: "user" }], "Scope"),
          select(status, setStatus, [{ value: "", label: "All statuses" }, { value: "active", label: "active" }, { value: "superseded", label: "superseded" }, { value: "archived", label: "archived" }], "Status"),
          select(
            project,
            setProject,
            [{ value: "", label: "All projects" }].concat((props.projects || []).map((value) => ({ value, label: projectName(value) }))),
            "Project",
            "auto",
          ),
          select(
            sort,
            setSort,
            [{ value: "updated", label: "Recently updated" }, { value: "created", label: "Recently created" }, { value: "importance", label: "Importance" }],
            "Sort",
            "auto",
          ),
          activeFilters ? h(Btn, { variant: "ghost", size: "sm", onClick: resetFilters }, "Reset") : null,
        ),
        error
          ? h(Card, { body: h("div", { className: "notice error" }, error) })
          : h(Card, {
              flush: true,
              body:
                items === null
                  ? h(Loading, { text: "Loading entries\u2026" })
                  : h(DataTable, {
                      columns,
                      rows: items,
                      onRow: (entry) => props.handlers.onOpen(entry.id),
                      empty: {
                        title: "No entries match these filters",
                        text: "Change the filters or create a new memory entry.",
                        action: h(Btn, { onClick: props.onNew }, "New entry"),
                      },
                    }),
              foot:
                items && items.length
                  ? h(Pager, {
                      page: page + 1,
                      pageSize: Number(pageSize),
                      total,
                      pageSizes: pagination.pageSizes,
                      onPage: (next) => setPage(Math.max(0, next - 1)),
                      onPageSize: (size) => {
                        setPage(0);
                        setPageSize(String(size));
                      },
                    })
                  : null,
            }),
      );
    }

    /* ------------------------------------------------------------------ *
     * conversation.view — Create / Edit
     * ------------------------------------------------------------------ */

    function EditTab(props) {
      const draft = props.draft || {};
      const [form, setForm] = React.useState(() => ({
        id: draft.id || "",
        title: draft.title || "",
        kind: draft.kind || "facts",
        scope: draft.scope || "project",
        project: draft.project || "",
        tier: draft.tier || "normal",
        importance: String(draft.importance || 3),
        tags: (draft.tags || []).join(", "),
        keywords: draft.keywords || "",
        text: draft.text || "",
        supersedes: (draft.supersedes || []).join(", "),
        related: (draft.related || []).join(", "),
      }));
      const [status, setStatus] = React.useState({ text: "", error: false });
      const [busy, setBusy] = React.useState(false);

      const update = (field, value) => setForm((previous) => Object.assign({}, previous, { [field]: value }));

      const reset = () => {
        setForm({
          id: "",
          title: "",
          kind: "facts",
          scope: "project",
          project: "",
          tier: "normal",
          importance: "3",
          tags: "",
          keywords: "",
          text: "",
          supersedes: "",
          related: "",
        });
        setStatus({ text: "", error: false });
      };

      const save = async () => {
        setBusy(true);
        setStatus({ text: "Saving\u2026", error: false });
        const body = {
          title: form.title.trim(),
          text: form.text,
          kind: form.kind,
          scope: form.scope,
          project: form.project.trim(),
          tier: form.tier,
          importance: Number(form.importance),
          tags: splitList(form.tags),
          keywords: form.keywords.trim(),
          supersedes: splitList(form.supersedes),
          related: splitList(form.related),
        };
        if (form.id) body.id = form.id;
        try {
          const data = await apiPost(props.base, "/api/save", body);
          setStatus({
            text: data.mode === "updated" ? "Updated " + data.item.id : "Created " + data.item.id,
            error: false,
          });
          if (data.mode === "created") reset();
          props.onSaved();
        } catch (error) {
          setStatus({ text: errorText(error), error: true });
        } finally {
          setBusy(false);
        }
      };

      const selectField = (label, value, setter, options) =>
        h(
          Field,
          { label },
          h(
            "select",
            { className: "select", value, onChange: (event) => setter(event.target.value) },
            options.map((option) => h("option", { key: option, value: option }, option)),
          ),
        );

      return h(
        "div",
        { className: "page" },
        h(PageHead, {
          title: form.id ? "Edit entry" : "New entry",
          sub: VIEW_SUBTITLES.editor,
          actions: h(Btn, { variant: "ghost", size: "sm", onClick: reset }, "Reset"),
        }),
        h(Card, {
          title: form.id ? form.id : "Memory entry",
          sub: "Fields map one-to-one onto the memory schema; nothing is added on the panel side.",
          body: h(
            "div",
            null,
            h(
              "div",
              { className: "form-grid" },
              h(
                Field,
                { label: "Title", wide: true },
                h("input", {
                  className: "input",
                  type: "text",
                  value: form.title,
                  onChange: (event) => update("title", event.target.value),
                }),
              ),
              selectField("Kind", form.kind, (value) => update("kind", value), KINDS),
              selectField("Scope", form.scope, (value) => update("scope", value), ["project", "user"]),
              h(
                Field,
                { label: "Project", hint: "project key (project scope only)" },
                h("input", {
                  className: "input",
                  type: "text",
                  value: form.project,
                  onChange: (event) => update("project", event.target.value),
                }),
              ),
              selectField("Tier", form.tier, (value) => update("tier", value), ["normal", "important", "immutable"]),
              h(
                Field,
                { label: "Importance (1-5)" },
                h("input", {
                  className: "input",
                  type: "number",
                  min: 1,
                  max: 5,
                  value: form.importance,
                  onChange: (event) => update("importance", event.target.value),
                }),
              ),
              h(
                Field,
                { label: "Tags (comma separated)" },
                h("input", {
                  className: "input",
                  type: "text",
                  value: form.tags,
                  onChange: (event) => update("tags", event.target.value),
                }),
              ),
              h(
                Field,
                { label: "Keywords" },
                h("input", {
                  className: "input",
                  type: "text",
                  value: form.keywords,
                  onChange: (event) => update("keywords", event.target.value),
                }),
              ),
              h(
                Field,
                { label: "Text", wide: true },
                h("textarea", {
                  className: "textarea",
                  rows: 8,
                  value: form.text,
                  onChange: (event) => update("text", event.target.value),
                }),
              ),
              h(
                Field,
                { label: "Supersedes (comma separated ids)" },
                h("input", {
                  className: "input",
                  type: "text",
                  value: form.supersedes,
                  onChange: (event) => update("supersedes", event.target.value),
                }),
              ),
              h(
                Field,
                { label: "Related (comma separated ids)" },
                h("input", {
                  className: "input",
                  type: "text",
                  value: form.related,
                  onChange: (event) => update("related", event.target.value),
                }),
              ),
            ),
            h(
              "div",
              { className: "actions" },
              h(Btn, { variant: "primary", disabled: busy, onClick: save }, busy ? "Saving\u2026" : "Save entry"),
              h(Btn, { disabled: busy, onClick: reset }, "Reset"),
              h(Notice, { text: status.text, error: status.error }),
            ),
          ),
        }),
      );
    }

    /* ------------------------------------------------------------------ *
     * conversation.view — Graph
     * ------------------------------------------------------------------ */

    function layoutGraph(entities, edges, width, height) {
      const nodes = entities.map((entity, index) => {
        const angle = (index / Math.max(1, entities.length)) * Math.PI * 2;
        return {
          id: entity.id,
          name: entity.name,
          kind: entity.kind,
          x: width / 2 + Math.cos(angle) * (width / 4),
          y: height / 2 + Math.sin(angle) * (height / 4),
          vx: 0,
          vy: 0,
          degree: 0,
        };
      });
      const byId = {};
      nodes.forEach((node) => {
        byId[node.id] = node;
      });
      const links = edges
        .map((edge) => ({ type: edge.type, s: byId[edge.source], t: byId[edge.target] }))
        .filter((edge) => edge.s && edge.t);
      links.forEach((edge) => {
        edge.s.degree += 1;
        edge.t.degree += 1;
      });

      const ticks = 300;
      for (let step = 0; step < ticks; step += 1) {
        const alpha = 1 - step / ticks;
        for (let i = 0; i < nodes.length; i += 1) {
          for (let j = i + 1; j < nodes.length; j += 1) {
            const a = nodes[i];
            const b = nodes[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const force = 1800 / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx += fx;
            a.vy += fy;
            b.vx -= fx;
            b.vy -= fy;
          }
        }
        links.forEach((edge) => {
          const dx = edge.t.x - edge.s.x;
          const dy = edge.t.y - edge.s.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const force = (dist - 130) * 0.02;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          edge.s.vx += fx;
          edge.s.vy += fy;
          edge.t.vx -= fx;
          edge.t.vy -= fy;
        });
        nodes.forEach((node) => {
          node.vx += (width / 2 - node.x) * 0.002;
          node.vy += (height / 2 - node.y) * 0.002;
          node.x += node.vx * alpha;
          node.y += node.vy * alpha;
          node.vx *= 0.6;
          node.vy *= 0.6;
        });
      }
      let maxDegree = 1;
      nodes.forEach((node) => {
        if (node.degree > maxDegree) maxDegree = node.degree;
      });
      return { nodes, links, maxDegree };
    }

    function GraphTab(props) {
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState("");
      const [view, setView] = React.useState({ scale: 1, tx: 0, ty: 0 });
      const [width, setWidth] = React.useState(900);
      const svgRef = React.useRef(null);
      const dragRef = React.useRef(null);

      React.useEffect(() => {
        let alive = true;
        apiGet(props.base, "/api/graph")
          .then((result) => {
            if (alive) setData(result);
          })
          .catch((err) => {
            if (alive) setError(errorText(err));
          });
        return () => {
          alive = false;
        };
      }, [props.base]);

      React.useEffect(() => {
        const element = svgRef.current;
        if (element && element.clientWidth > 0) setWidth(element.clientWidth);
      }, []);

      React.useEffect(() => {
        const element = svgRef.current;
        if (!element) return undefined;
        // A passive React onWheel listener cannot preventDefault, so the zoom
        // handler is attached natively.
        const onWheel = (event) => {
          event.preventDefault();
          const factor = event.deltaY < 0 ? 1.1 : 0.9;
          setView((previous) =>
            Object.assign({}, previous, { scale: Math.min(4, Math.max(0.3, previous.scale * factor)) }),
          );
        };
        element.addEventListener("wheel", onWheel, { passive: false });
        return () => element.removeEventListener("wheel", onWheel);
      }, []);

      const layout = React.useMemo(
        () => (data ? layoutGraph(data.entities || [], data.edges || [], width, GRAPH_HEIGHT) : null),
        [data, width],
      );

      React.useEffect(() => {
        const onMove = (event) => {
          const drag = dragRef.current;
          if (!drag) return;
          setView((previous) =>
            Object.assign({}, previous, {
              tx: previous.tx + (event.clientX - drag.x),
              ty: previous.ty + (event.clientY - drag.y),
            }),
          );
          dragRef.current = { x: event.clientX, y: event.clientY };
        };
        const onUp = () => {
          dragRef.current = null;
          if (svgRef.current) svgRef.current.style.cursor = "grab";
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
      }, []);

      const onMouseDown = (event) => {
        if (event.target && event.target.getAttribute && event.target.getAttribute("data-node")) return;
        dragRef.current = { x: event.clientX, y: event.clientY };
        if (svgRef.current) svgRef.current.style.cursor = "grabbing";
      };

      const onClick = (event) => {
        const id = event.target && event.target.getAttribute ? event.target.getAttribute("data-node") : null;
        if (id) props.onOpen(id);
      };

      const children = [];
      if (layout) {
        children.push(
          h(
            "defs",
            { key: "defs" },
            h(
              "marker",
              { id: "llm-memory-arrow", viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" },
              h("path", { d: "M0,0 L10,5 L0,10 z", fill: T.tertiary }),
            ),
          ),
        );
        children.push(
          h(
            "g",
            {
              key: "viewport",
              transform: "translate(" + view.tx + "," + view.ty + ") scale(" + view.scale + ")",
            },
            layout.links.map((edge, index) =>
              h("line", {
                key: "e" + index,
                x1: edge.s.x.toFixed(1),
                y1: edge.s.y.toFixed(1),
                x2: edge.t.x.toFixed(1),
                y2: edge.t.y.toFixed(1),
                stroke: EDGE_COLORS[edge.type] || T.tertiary,
                strokeOpacity: 0.55,
                strokeWidth: 1.2,
                markerEnd: "url(#llm-memory-arrow)",
              }),
            ),
            layout.nodes.map((node) =>
              h(
                "g",
                { key: node.id },
                h("circle", {
                  "data-node": node.id,
                  cx: node.x.toFixed(1),
                  cy: node.y.toFixed(1),
                  r: 6 + Math.round((node.degree / layout.maxDegree) * 10),
                  fill: KIND_COLORS[node.kind] || T.tertiary,
                  stroke: T.bg1,
                  strokeWidth: 1.5,
                  style: { cursor: "pointer" },
                }),
                h(
                  "text",
                  {
                    x: node.x.toFixed(1),
                    y: (node.y - (6 + Math.round((node.degree / layout.maxDegree) * 10)) - 4).toFixed(1),
                    fill: T.secondary,
                    fontSize: 10,
                    textAnchor: "middle",
                  },
                  String(node.name).slice(0, 40),
                ),
              ),
            ),
          ),
        );
      }

      return h(
        "div",
        { className: "page" },
        h(PageHead, {
          title: "Knowledge graph",
          sub: VIEW_SUBTITLES.graph,
          actions: h(Btn, { variant: "ghost", size: "sm", onClick: () => setView({ scale: 1, tx: 0, ty: 0 }) }, "Reset view"),
        }),
        h(Card, {
          title: "Links between entries",
          sub: "Wheel to zoom, drag to pan, click a node for details.",
          body: h(
            "div",
            null,
            h(
              "div",
              { className: "chips mb-8" },
              KINDS.map((kind) =>
                h(
                  "span",
                  { key: kind, className: "chip", style: { cursor: "default" } },
                  h("i", { className: "kind-dot", style: { background: KIND_COLORS[kind], "--kc": KIND_COLORS[kind] } }),
                  kind,
                ),
              ),
            ),
            error
              ? h("div", { className: "notice error" }, error)
              : h(
                  "div",
                  { className: "graph-box" },
                  h("svg", { ref: svgRef, className: "graph-svg", onMouseDown, onClick }, children),
                  h("div", { className: "graph-hint" }, "Wheel to zoom \u00b7 drag to pan \u00b7 click a node for details"),
                ),
          ),
        }),
      );
    }

    /* ------------------------------------------------------------------ *
     * conversation.view — Map (the embedding space, two leading axes)
     * ------------------------------------------------------------------ */

    const MAP_HEIGHT = 540;
    /** Colour per project in the "by project" mode; index comes from a hash. */
    const MAP_PALETTE = [
      "#4c8bf5",
      "#e8a33d",
      "#43b581",
      "#c678dd",
      "#e06c75",
      "#56b6c2",
      "#d19a66",
      "#8fbf5f",
      "#9a7ff2",
      "#5fb3a1",
    ];
    /** Semantic edges drawn at most; the graph itself has thousands. */
    const MAP_MAX_EDGES = 600;

    function mapProjectColor(project) {
      let hash = 0;
      const text = String(project || "");
      for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
      return MAP_PALETTE[hash % MAP_PALETTE.length];
    }

    /**
     * Turns map coordinates into canvas coordinates once, so panning and zooming
     * only add a transform on top. Bounds come from every point, not the filtered
     * ones: changing a filter must not move the picture.
     */
    function layoutMap(points, edges, width, height) {
      const pad = 26;
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const minX = xs.length > 0 ? Math.min.apply(null, xs) : 0;
      const maxX = xs.length > 0 ? Math.max.apply(null, xs) : 1;
      const minY = ys.length > 0 ? Math.min.apply(null, ys) : 0;
      const maxY = ys.length > 0 ? Math.max.apply(null, ys) : 1;
      const spanX = maxX - minX || 1;
      const spanY = maxY - minY || 1;
      const innerW = Math.max(40, width - pad * 2);
      const innerH = Math.max(40, height - pad * 2);
      /** Raw map coordinates -> canvas coordinates (y flipped, so up is up). */
      const place = (x, y) => [
        pad + ((x - minX) / spanX) * innerW,
        height - pad - ((y - minY) / spanY) * innerH,
      ];

      const items = points.map((point) => {
        const spot = place(point.x, point.y);
        return { point, wx: spot[0], wy: spot[1] };
      });
      const byId = new Map(items.map((item) => [item.point.id, item]));
      const links = [];
      for (const edge of edges) {
        if (edge.type && edge.type !== "related") continue;
        const from = byId.get(edge.source);
        const to = byId.get(edge.target);
        if (!from || !to) continue;
        links.push({ from, to, weight: Number(edge.weight) || 0 });
        if (links.length >= MAP_MAX_EDGES) break;
      }
      const maxChunks = items.reduce((max, item) => Math.max(max, item.point.chunks || 1), 1);
      return { items, links, maxChunks, place };
    }

    /** Multi-chunk entries carry more text, so their points read bigger. */
    function mapRadius(chunks, maxChunks) {
      return 2.4 + 4 * Math.sqrt((chunks || 1) / maxChunks);
    }

    function MapTab(props) {
      const [payload, setPayload] = React.useState(null);
      const [edges, setEdges] = React.useState([]);
      const [error, setError] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [colorBy, setColorBy] = React.useState("project");
      const [kindFilter, setKindFilter] = React.useState("");
      const [projectFilter, setProjectFilter] = React.useState("");
      const [scopeFilter, setScopeFilter] = React.useState("");
      const [statusFilter, setStatusFilter] = React.useState("active");
      const [queryText, setQueryText] = React.useState("");
      const [placed, setPlaced] = React.useState(null);
      const [queryNote, setQueryNote] = React.useState("");
      const [hover, setHover] = React.useState(null);
      const [width, setWidth] = React.useState(900);
      // Panning and zooming live in a ref (no re-render per mouse move); this
      // counter is what tells the drawing effect that the view moved.
      const [viewTick, setViewTick] = React.useState(0);
      const canvasRef = React.useRef(null);
      const wrapRef = React.useRef(null);
      const viewRef = React.useRef({ scale: 1, tx: 0, ty: 0 });
      const dragRef = React.useRef(null);
      const map = payload && payload.map ? payload.map : null;
      const reason = payload ? payload.reason : null;
      const points = map ? map.points || [] : [];

      const load = React.useCallback(
        (refresh) => {
          setBusy(true);
          apiGet(props.base, "/api/vectors/map" + (refresh ? "?refresh=1" : ""))
            .then((result) => {
              setPayload(result);
              setError("");
            })
            .catch((err) => setError(errorText(err)))
            .then(() => setBusy(false));
        },
        [props.base],
      );

      React.useEffect(() => {
        load(false);
      }, [load]);

      React.useEffect(() => {
        let alive = true;
        apiGet(props.base, "/api/graph")
          .then((result) => {
            if (alive) setEdges((result && result.edges) || []);
          })
          .catch(() => undefined);
        return () => {
          alive = false;
        };
      }, [props.base]);

      // The wrapper only exists once the map is drawn, so the observer is created
      // after that. Measuring once at mount left `width` at its 900 default while
      // CSS stretched the canvas across the panel: the picture came out stretched
      // and every hit test missed (the 16.10.2026 "skewed map" report).
      React.useEffect(() => {
        const element = wrapRef.current;
        if (!element) return undefined;
        const measure = () => {
          if (element.clientWidth > 0) setWidth(element.clientWidth);
        };
        measure();
        let observer = null;
        if (typeof ResizeObserver === "function") {
          observer = new ResizeObserver(measure);
          observer.observe(element);
        }
        window.addEventListener("resize", measure);
        return () => {
          window.removeEventListener("resize", measure);
          if (observer) observer.disconnect();
        };
      }, [map]);

      const projects = React.useMemo(
        () => Array.from(new Set(points.map((point) => point.project))).sort(),
        [points],
      );
      const visible = React.useMemo(
        () =>
          points.filter(
            (point) =>
              (!kindFilter || point.kind === kindFilter) &&
              (!projectFilter || point.project === projectFilter) &&
              (!scopeFilter || point.scope === scopeFilter) &&
              (!statusFilter || statusFilter === "all" || point.status === statusFilter),
          ),
        [points, kindFilter, projectFilter, scopeFilter, statusFilter],
      );
      const layout = React.useMemo(() => layoutMap(points, edges, width, MAP_HEIGHT), [points, edges, width]);
      const visibleLayout = React.useMemo(() => {
        const ids = new Set(visible.map((point) => point.id));
        return {
          items: layout.items.filter((item) => ids.has(item.point.id)),
          links: layout.links.filter((link) => ids.has(link.from.point.id) && ids.has(link.to.point.id)),
        };
      }, [layout, visible]);
      const hitIds = React.useMemo(() => new Set(placed ? placed.hits.map((hit) => hit.id) : []), [placed]);

      /** Centre-relative transform: panning and zooming never touch the data. */
      const toScreen = React.useCallback(
        (wx, wy) => {
          const view = viewRef.current;
          const cx = width / 2;
          const cy = MAP_HEIGHT / 2;
          return [cx + (wx - cx) * view.scale + view.tx, cy + (wy - cy) * view.scale + view.ty];
        },
        [width],
      );

      React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !map) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(MAP_HEIGHT * ratio));
        const ctx = canvas.getContext("2d");
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, width, MAP_HEIGHT);
        const { items, links } = visibleLayout;
        const { maxChunks } = layout;
        const radiusOf = (item) => mapRadius(item.point.chunks, maxChunks) * Math.min(2, viewRef.current.scale);

        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(140, 150, 175, 0.22)";
        for (const link of links) {
          const from = toScreen(link.from.wx, link.from.wy);
          const to = toScreen(link.to.wx, link.to.wy);
          ctx.beginPath();
          ctx.moveTo(from[0], from[1]);
          ctx.lineTo(to[0], to[1]);
          ctx.stroke();
        }

        for (const item of items) {
          const spot = toScreen(item.wx, item.wy);
          ctx.beginPath();
          ctx.arc(spot[0], spot[1], radiusOf(item), 0, Math.PI * 2);
          ctx.fillStyle =
            colorBy === "kind" ? KIND_COLORS[item.point.kind] || T.tertiary : mapProjectColor(item.point.project);
          ctx.globalAlpha = item.point.status === "active" ? 0.92 : 0.4;
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        ctx.lineWidth = 2;
        ctx.strokeStyle = T.business;
        for (const item of items) {
          if (!hitIds.has(item.point.id)) continue;
          const spot = toScreen(item.wx, item.wy);
          ctx.beginPath();
          ctx.arc(spot[0], spot[1], radiusOf(item) + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (placed && layout.place) {
          const spot = toScreen.apply(null, layout.place(placed.x, placed.y));
          ctx.beginPath();
          ctx.arc(spot[0], spot[1], 9, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(spot[0] - 14, spot[1]);
          ctx.lineTo(spot[0] + 14, spot[1]);
          ctx.moveTo(spot[0], spot[1] - 14);
          ctx.lineTo(spot[0], spot[1] + 14);
          ctx.stroke();
        }
      }, [map, visibleLayout, layout, placed, hitIds, colorBy, width, toScreen, viewTick]);

      /** Nearest visible point to a screen position, within a forgiving radius. */
      const pick = React.useCallback(
        (event) => {
          const box = canvasRef.current ? canvasRef.current.getBoundingClientRect() : null;
          if (!box) return null;
          const px = event.clientX - box.left;
          const py = event.clientY - box.top;
          let best = null;
          let bestDistance = Infinity;
          const zoom = viewRef.current.scale;
          for (const item of visibleLayout.items) {
            const spot = toScreen(item.wx, item.wy);
            const distance = Math.hypot(spot[0] - px, spot[1] - py);
            // Generous hit area: the drawn radius grows with the zoom, and a point
            // has to stay reachable while it is still only a few pixels wide.
            const reach = Math.max(16, mapRadius(item.point.chunks, layout.maxChunks) * Math.min(2, zoom) + 8);
            if (distance < reach && distance < bestDistance) {
              bestDistance = distance;
              best = { item, px, py };
            }
          }
          return best;
        },
        [visibleLayout, toScreen, layout],
      );

      React.useEffect(() => {
        const canvas = canvasRef.current;
        // `map` is in the dependencies so the listener is attached once the canvas
        // exists: on the first run the map has not loaded yet and there was no
        // element to attach to (the 16.10.2026 "zoom does nothing" report).
        if (!canvas) return undefined;
        // Passive React onWheel handlers cannot preventDefault, so zoom is native.
        const onWheel = (event) => {
          event.preventDefault();
          const view = viewRef.current;
          const next = Math.min(6, Math.max(0.4, view.scale * (event.deltaY < 0 ? 1.12 : 0.89)));
          const ratio = next / view.scale;
          const box = canvas.getBoundingClientRect();
          const px = event.clientX - box.left - width / 2;
          const py = event.clientY - box.top - MAP_HEIGHT / 2;
          view.scale = next;
          view.tx = px - (px - view.tx) * ratio;
          view.ty = py - (py - view.ty) * ratio;
          setHover(null);
          setViewTick((value) => value + 1);
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });
        return () => canvas.removeEventListener("wheel", onWheel);
      }, [width, map]);

      /** Cursor feedback; set straight on the element to avoid a re-render. */
      const setCursor = (value) => {
        if (canvasRef.current) canvasRef.current.style.cursor = value;
      };

      /** Zoom without the wheel: touchpads and shells that swallow wheel events. */
      const zoomBy = (factor) => {
        const view = viewRef.current;
        view.scale = Math.min(6, Math.max(0.4, view.scale * factor));
        setHover(null);
        setViewTick((value) => value + 1);
      };

      const onPointerDown = (event) => {
        dragRef.current = { x: event.clientX, y: event.clientY, moved: 0 };
        setCursor("grabbing");
        if (canvasRef.current && canvasRef.current.setPointerCapture) {
          try {
            canvasRef.current.setPointerCapture(event.pointerId);
          } catch (err) {
            // Pointer capture is a convenience; dragging still works without it.
          }
        }
      };

      const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (drag) {
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          drag.x = event.clientX;
          drag.y = event.clientY;
          drag.moved += Math.abs(dx) + Math.abs(dy);
          if (drag.moved > 3) {
            viewRef.current.tx += dx;
            viewRef.current.ty += dy;
            if (hover) setHover(null);
            setViewTick((value) => value + 1);
          }
          return;
        }
        const picked = pick(event);
        if (!picked) {
          if (hover) setHover(null);
          return;
        }
        if (!hover || hover.point.id !== picked.item.point.id) {
          setHover({ point: picked.item.point, left: picked.px, top: picked.py });
        }
      };

      const onPointerUp = (event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        setCursor("grab");
        if (drag && drag.moved <= 3) {
          const picked = pick(event);
          if (picked) props.onOpen(picked.item.point.id);
        }
      };

      const resetView = () => {
        viewRef.current = { scale: 1, tx: 0, ty: 0 };
        setHover(null);
        setViewTick((value) => value + 1);
      };

      const placeQuery = () => {
        const text = queryText.trim();
        if (text.length === 0) return;
        setQueryNote("Embedding the query\u2026");
        apiPost(props.base, "/api/vectors/map/query", { text, limit: 5 })
          .then((result) => {
            setPlaced(result);
            setQueryNote(
              result.hits.length > 0
                ? "Closest entries are ringed; the crosshair is the query itself."
                : "The query landed on the map, but nothing is close enough to ring.",
            );
          })
          .catch((err) => {
            setPlaced(null);
            setQueryNote(errorText(err));
          });
      };

      const reasonText = {
        "not-configured": "Vector search is off: turn it on in Settings \u2192 LLM Memory to build the map.",
        "model-missing": "The embedding model is not downloaded yet: get it in Settings \u2192 LLM Memory.",
        indexing:
          "Embeddings are still being computed. The map appears once the queue drains \u2014 press Refresh in a moment.",
        empty: "No entry has been embedded yet, so there is nothing to place.",
      };
      const legendValues = colorBy === "kind" ? KINDS : projects;
      const select = (value, setter, options, label) =>
        h(
          "select",
          { className: "select", style: { width: "auto", minWidth: "120px" }, value, "aria-label": label, onChange: (event) => setter(event.target.value) },
          options.map(([optionValue, text]) => h("option", { key: optionValue, value: optionValue }, text)),
        );

      return h(
        "div",
        { className: "page" },
        h(PageHead, {
          title: "RAG map",
          sub: VIEW_SUBTITLES.map,
          actions: h(Btn, { size: "sm", variant: "ghost", onClick: resetView }, "Reset view"),
        }),
        h(Card, {
          body: h(
            "div",
            null,
            h(
              "p",
              { className: "page-sub", style: { marginTop: 0 } },
              map
                ? "Entries placed by the two leading principal components of their embeddings: close points mean similar meaning. The axes carry " +
                  Math.round((map.explained[0] + map.explained[1]) * 100) +
                  "% of the variance; " +
                  map.entries +
                  " points from " +
                  map.chunks +
                  " chunks."
                : "The semantic map projects every entry embedding onto two axes, so related memories land next to each other.",
            ),
            h(
              "div",
              { className: "toolbar" },
              select(colorBy, setColorBy, [["project", "by project"], ["kind", "by kind"]], "Colour"),
              select(statusFilter, setStatusFilter, [["active", "active"], ["superseded", "superseded"], ["archived", "archived"], ["all", "all"]], "Status"),
              select(kindFilter, setKindFilter, [["", "any kind"]].concat(KINDS.map((kind) => [kind, kind])), "Kind"),
              select(projectFilter, setProjectFilter, [["", "any project"]].concat(projects.map((project) => [project, projectName(project)])), "Project"),
              select(scopeFilter, setScopeFilter, [["", "any scope"], ["project", "project"], ["user", "user"]], "Scope"),
              h("span", { className: "grow" }),
              h(Btn, { size: "sm", onClick: () => zoomBy(1.25) }, "Zoom +"),
              h(Btn, { size: "sm", onClick: () => zoomBy(0.8) }, "Zoom \u2212"),
            ),
            map
              ? h(
                  "div",
                  { className: "toolbar" },
                  h("input", {
                    className: "input",
                    style: { flex: "1 1 280px" },
                    type: "search",
                    value: queryText,
                    placeholder: "Free text: where does recall look?",
                    onChange: (event) => setQueryText(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === "Enter") placeQuery();
                    },
                  }),
                  h(Btn, { onClick: placeQuery }, "Show on map"),
                  placed ? h(Btn, { variant: "ghost", onClick: () => { setPlaced(null); setQueryNote(""); } }, "Clear") : null,
                )
              : null,
            queryNote ? h("p", { className: "page-sub", style: { fontSize: "12px" } }, queryNote) : null,
            error ? h("div", { className: "notice error" }, error) : null,
            map
              ? h(
                  "div",
                  null,
                  h(
                    "div",
                    { className: "chips mb-8" },
                    legendValues.map((value) =>
                      h(
                        "span",
                        { key: value, className: "chip", style: { cursor: "default" } },
                        h("i", {
                          className: "kind-dot",
                          style: { background: colorBy === "kind" ? KIND_COLORS[value] || "var(--text-3)" : mapProjectColor(value) },
                        }),
                        projectName(value),
                      ),
                    ),
                    h("span", { className: "faint", style: { fontSize: "11.5px" } }, visible.length + " of " + points.length + " points shown"),
                  ),
                  h(
                    "div",
                    { className: "graph-box", ref: wrapRef },
                    h("canvas", {
                      ref: canvasRef,
                      style: {
                        width: "100%",
                        height: MAP_HEIGHT + "px",
                        background: "var(--surface)",
                        cursor: "grab",
                        display: "block",
                      },
                      onPointerDown,
                      onPointerMove,
                      onPointerUp,
                      onPointerLeave: () => {
                        dragRef.current = null;
                        setCursor("grab");
                        setHover(null);
                      },
                      onDoubleClick: resetView,
                    }),
                    hover
                      ? h(
                          "div",
                          {
                            style: {
                              position: "absolute",
                              left: Math.min(hover.left + 12, Math.max(0, width - 270)) + "px",
                              top: Math.max(6, hover.top - 10) + "px",
                              maxWidth: "260px",
                              padding: "8px 10px",
                              fontSize: "11.5px",
                              lineHeight: "1.35",
                              color: "var(--text)",
                              background: "var(--surface)",
                              border: "1px solid var(--border)",
                              borderRadius: "var(--radius-sm)",
                              boxShadow: "var(--shadow-2)",
                              pointerEvents: "none",
                            },
                          },
                          hover.point.title || hover.point.id,
                          h("div", { style: { color: "var(--text-2)" } }, hover.point.kind + " \u00b7 " + projectName(hover.point.project)),
                          h(
                            "div",
                            { style: { color: "var(--text-3)" } },
                            hover.point.chunks + (hover.point.chunks === 1 ? " chunk" : " chunks") + (hover.point.status === "active" ? "" : " \u00b7 " + hover.point.status),
                          ),
                        )
                      : null,
                    h("div", { className: "graph-hint" }, "Wheel to zoom \u00b7 drag to pan \u00b7 click a point for details"),
                  ),
                )
              : h(Empty, {
                  title: "The map is not ready",
                  text: reason ? reasonText[reason] || reason : "Loading the map\u2026",
                  action: h(Btn, { onClick: () => load(true) }, "Try again"),
                }),
          ),
        }),
      );
    }

    /* ------------------------------------------------------------------ *
     * conversation.view — Recall (what the agent would actually receive)
     * ------------------------------------------------------------------ */

    const RECALL_FORMATS = ["markdown", "table", "timeline", "json"];

    function RecallTab(props) {
      const [query, setQuery] = React.useState("");
      const [format, setFormat] = React.useState("");
      const [result, setResult] = React.useState(null);
      const [error, setError] = React.useState("");
      const [busy, setBusy] = React.useState(false);

      const run = () => {
        const text = query.trim();
        if (text.length === 0) return;
        setBusy(true);
        apiPost(props.base, "/api/recall", format ? { query: text, format } : { query: text })
          .then((payload) => {
            setResult(payload);
            setError("");
          })
          .catch((err) => {
            setResult(null);
            setError(errorText(err));
          })
          .then(() => setBusy(false));
      };

      const legs = (item) => (item.sources || []).map((leg) => h(Chip, { key: leg }, leg));
      const suggestions = ["TDD", "panel design", "Kilo projects", "memory rules"];

      return h(
        "div",
        { className: "page" },
        h(PageHead, { title: "Recall", sub: VIEW_SUBTITLES.recall }),
        h(Card, {
          body: h(
            "div",
            null,
            h(
              "div",
              { className: "flex gap-8", style: { flexWrap: "wrap", alignItems: "center" } },
              h("input", {
                className: "input",
                style: { flex: "1 1 280px" },
                type: "search",
                value: query,
                placeholder: "Free text, as the agent would ask",
                onChange: (event) => setQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") run();
                },
              }),
              h(
                "select",
                { className: "select", style: { width: "auto", minWidth: "150px" }, value: format, onChange: (event) => setFormat(event.target.value) },
                [["", "settings default"]]
                  .concat(RECALL_FORMATS.map((item) => [item, item]))
                  .map(([value, text]) => h("option", { key: value, value }, text)),
              ),
              h(Btn, { variant: "primary", disabled: busy, onClick: run }, busy ? "Recalling\u2026" : "Run recall"),
            ),
            h(
              "div",
              { className: "chips mt-8" },
              h("span", { className: "faint", style: { fontSize: "12px" } }, "Try:"),
              suggestions.map((text) => h(Chip, { key: text, onClick: () => setQuery(text) }, text)),
            ),
          ),
        }),
        error ? h(Card, { className: "mt-16", body: h("div", { className: "notice error" }, error) }) : null,
        result
          ? h(
              "div",
              { className: "mt-16" },
              h(Card, {
                title: "Hits (" + result.items.length + ")",
                sub: "Lexical and semantic legs that brought each entry in.",
                body:
                  result.items.length === 0
                    ? h(Empty, { title: "Nothing matched", text: "Try a broader phrase or a different format." })
                    : h(
                        "div",
                        { className: "stack", style: { gap: "10px" } },
                        result.items.map((item) =>
                          h(
                            "div",
                            { key: item.id, className: "result card", onClick: () => props.onOpen(item.id) },
                            h(
                              "div",
                              { className: "result-head" },
                              h("div", { className: "result-title" }, item.title || item.id),
                              item.score !== undefined ? h(Badge, { tone: "accent" }, Math.round(item.score * 100) + "%") : null,
                            ),
                            h(
                              "div",
                              { className: "result-meta" },
                              h(Badge, { tone: KIND_TONES[item.kind] || "" }, item.kind),
                              h("span", { className: "faint" }, item.scope + (item.project ? " / " + projectName(item.project) : "")),
                              h("span", { className: "faint" }, item.status),
                            ),
                            h("div", { className: "chips mt-8" }, legs(item)),
                          ),
                        ),
                      ),
              }),
              h(Card, {
                className: "mt-16",
                title: "Rendered text (" + result.format + ")",
                sub: "Exactly what the agent receives from the recall tool.",
                body: h("pre", { className: "report", style: { whiteSpace: "pre-wrap", margin: 0 } }, result.text),
              }),
            )
          : null,
      );
    }

    /* ------------------------------------------------------------------ *
     * conversation.view — Status and Lint
     * ------------------------------------------------------------------ */

    function formatByteSize(value) {
      const bytes = typeof value === "number" ? value : 0;
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " kB";
      return (bytes / 1024 / 1024).toFixed(2) + " MB";
    }

    /** One human line describing the embedding-model cache state. */
    function modelStatusText(model) {
      if (!model) return "Model status is unavailable: the plugin API did not answer.";
      if (model.error) return "Download failed: " + model.error;
      if (model.downloading) {
        const progress = model.progress;
        if (!progress) return "Downloading the model\u2026 (waiting for the first bytes)";
        const loaded = formatByteSize(progress.loadedBytes);
        const total = progress.totalBytes > 0 ? formatByteSize(progress.totalBytes) : "unknown size";
        return (
          "Downloading: " +
          progress.percent +
          "% (" +
          loaded +
          " of " +
          total +
          "), files: " +
          progress.files
        );
      }
      if (model.configured === false) {
        return "Vector search is off (provider or backend). Turn it on, save, then download the model.";
      }
      if (model.cached) {
        return (
          "Cached: " +
          formatByteSize(model.bytes) +
          " in " +
          model.files +
          " files" +
          (model.enabled === true ? " \u2014 search uses it now." : " \u2014 restart the plugin to switch search on.")
        );
      }
      if (model.files > 0) {
        return (
          "Cache is incomplete: " +
          formatByteSize(model.bytes) +
          " in " +
          model.files +
          " files. Press Download model to replace it."
        );
      }
      return (
        "Not downloaded yet (\u2248130 MB). Lexical search works; semantic search starts after the download." +
        (model.enabled === true ? "" : " Vector search is currently off because the model is missing.")
      );
    }

    function VectorPanel(props) {
      const vectors = props.vectors;
      if (!vectors) {
        return h(
          "div",
          null,
          h("h3", { style: S.sectionTitle }, "Semantic index"),
          h(
            "p",
            { style: S.hint },
            "Vectors are off: recall uses lexical search (FTS5) only. Turn them on in Settings \u2192 LLM Memory \u2192 embeddings.",
          ),
        );
      }
      const meta =
        "model: " +
        vectors.model +
        " \u00b7 backend: " +
        vectors.backend +
        "\nindexed: " +
        vectors.entries +
        " entries / " +
        vectors.chunks +
        " chunks \u00b7 " +
        formatByteSize(vectors.bytes) +
        " of vectors" +
        (vectors.disabled ? "\nindexing disabled after repeated failures" : "") +
        (vectors.running ? "\nindexing in progress" : "") +
        (vectors.lastError ? "\nlast error: " + vectors.lastError : "");
      return h(
        "div",
        null,
        h("h3", { style: S.sectionTitle }, "Semantic index"),
        h(
          "div",
          { style: S.kpis },
          h(Kpi, { value: vectors.entries, label: "Embedded entries" }),
          h(Kpi, { value: vectors.chunks, label: "Vectors" }),
          h(Kpi, { value: vectors.pending, label: "Queue" }),
          h(Kpi, { value: vectors.embedded, label: "Embedded this run" }),
        ),
        h("div", { style: S.meta }, meta),
      );
    }

    function StatusPanel(props) {
      const [report, setReport] = React.useState(null);
      const [recent, setRecent] = React.useState(null);
      const [error, setError] = React.useState("");

      React.useEffect(() => {
        let alive = true;
        Promise.all([
          apiGet(props.base, "/api/status"),
          apiGet(props.base, "/api/items?limit=6&sort=updated").catch(() => ({ items: [] })),
        ])
          .then(([data, items]) => {
            if (!alive) return;
            setReport(data);
            setRecent(items.items || []);
            setError("");
          })
          .catch((err) => {
            if (alive) setError(errorText(err));
          });
        return () => {
          alive = false;
        };
      }, [props.base, props.version]);

      if (error) return h(Card, { body: h("div", { className: "notice error" }, error) });
      if (!report) return h(Loading, { text: "Loading memory state\u2026" });

      const vectors = report.vectors;
      const vectorBadge = !vectors || vectors.disabled
        ? h(Badge, null, "off")
        : vectors.running
          ? h(Badge, { tone: "warn" }, "running")
          : vectors.pending > 0
            ? h(Badge, { tone: "warn" }, String(vectors.pending))
            : h(Badge, { tone: "ok" }, "ok");
      const projects = (props.projects || []).length || report.projects || Object.keys(report.byProject || {}).length;

      const metric = (label, value, extra) =>
        h(
          "div",
          { className: "metric-line" },
          h("span", { className: "muted" }, label),
          h("span", { className: "flex items-center gap-8", style: { minWidth: 0, justifyContent: "flex-end" } }, value, extra || null),
        );

      const recentTable = h(DataTable, {
        columns: [
          { path: "title", label: "Title" },
          { path: "kind", label: "Kind" },
          { path: "updatedAt", label: "Updated" },
        ],
        rows: recent || [],
        onRow: (entry) => props.onOpen(entry.id),
        empty: { title: "No memory entries yet", text: "Create the first entry to see it here." },
      });

      return h(
        "div",
        { className: "page" },
        h(PageHead, {
          title: "Overview",
          sub: VIEW_SUBTITLES.overview,
          actions: h(Btn, { onClick: props.onGoEntries }, "All entries"),
        }),
        h(
          "div",
          { className: "grid-kpi" },
          h(Stat, { label: "Entries", value: report.total }),
          h(Stat, { label: "Active", value: report.active }),
          h(Stat, { label: "Rules", value: (report.byKind || {}).rules || 0 }),
          h(Stat, { label: "Preferences", value: (report.byKind || {}).preferences || 0 }),
          h(Stat, { label: "Projects", value: projects }),
        ),
        h(
          "div",
          { className: "grid-2 mt-16" },
          h(Card, {
            title: "Recent entries",
            sub: "The last six entries by update time.",
            flush: true,
            body: recentTable,
          }),
          h(Card, {
            title: "Memory state",
            sub: "Store, database and the semantic index.",
            body: h(
              "div",
              null,
              metric("Store", h("span", { className: "mono truncate", style: { maxWidth: "170px" }, title: report.root || "" }, report.root || "\u2014")),
              metric("Database", h("span", null, formatByteSize(report.dbSizeBytes))),
              metric("Vectors", h("span", { className: "mono" }, (vectors ? vectors.entries || 0 : 0) + " \u00b7 " + (vectors ? vectors.chunks || 0 : 0)), vectorBadge),
              metric("Model", h("span", { className: "truncate", style: { maxWidth: "170px" } }, vectors ? vectors.model || "\u2014" : "\u2014")),
              metric("Updated", h("span", { className: "muted" }, datePart(report.updatedAt))),
            ),
          }),
        ),
      );
    }

    function LintPanel(props) {
      const [report, setReport] = React.useState(null);
      const [error, setError] = React.useState("");

      React.useEffect(() => {
        let alive = true;
        apiGet(props.base, "/api/lint")
          .then((data) => {
            if (alive) {
              setReport(data);
              setError("");
            }
          })
          .catch((err) => {
            if (alive) setError(errorText(err));
          });
        return () => {
          alive = false;
        };
      }, [props.base, props.version]);

      if (error) return h("p", { style: Object.assign({}, S.hint, { color: T.danger }) }, error);
      if (!report) return h("p", { style: S.hint }, "Loading\u2026");

      return h(
        "div",
        null,
        h(
          "div",
          { style: S.kpis },
          h(Kpi, { value: report.totalCount, label: "Total entries" }),
          h(Kpi, { value: report.activeCount, label: "Active" }),
          h(Kpi, { value: report.brokenLinks.length, label: "Broken links" }),
          h(Kpi, { value: report.overlaps.length, label: "Overlapping pairs" }),
          h(Kpi, { value: report.stale.length, label: "Stale (> " + report.staleDays + "d)" }),
        ),
        h("h3", { style: S.sectionTitle }, "Broken links"),
        report.brokenLinks.length
          ? h(
              "ul",
              { style: S.list },
              report.brokenLinks.map((link) =>
                h("li", { key: link.id + ":" + link.field }, link.title + " (" + link.id + ") \u2192 " + link.field + ": " + link.missingId),
              ),
            )
          : h("p", { style: S.hint }, "none"),
        h("h3", { style: S.sectionTitle }, "Overlapping active pairs"),
        report.overlaps.length
          ? h(
              "ul",
              { style: S.list },
              report.overlaps.map((pair, index) =>
                h(
                  "li",
                  { key: index },
                  pair.aTitle + " \u2194 " + pair.bTitle + " (common " + pair.common + ", score " + pair.score + ")",
                ),
              ),
            )
          : h("p", { style: S.hint }, "none"),
        report.overlapsHidden
          ? h("p", { style: S.hint }, report.overlapsHidden + " more pairs hidden by the cap.")
          : null,
        h("h3", { style: S.sectionTitle }, "Stale entries"),
        report.stale.length
          ? h(
              "ul",
              { style: S.list },
              report.stale.map((entry) =>
                h("li", { key: entry.id }, entry.title + " (" + entry.id + ") \u00b7 updated " + datePart(entry.updatedAt)),
              ),
            )
          : h("p", { style: S.hint }, "none"),
      );
    }

    function HealthTab(props) {
      const [status, setStatus] = React.useState(null);
      const [lint, setLint] = React.useState(null);
      const [heal, setHeal] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState({ text: "", error: false });

      const load = React.useCallback(async () => {
        try {
          const [nextStatus, nextLint] = await Promise.all([
            apiGet(props.base, "/api/status"),
            apiGet(props.base, "/api/lint"),
          ]);
          setStatus(nextStatus);
          setLint(nextLint);
        } catch (error) {
          setNotice({ text: errorText(error), error: true });
        }
      }, [props.base]);

      React.useEffect(() => {
        void load();
      }, [load, props.version]);

      const run = async (label, task) => {
        setBusy(true);
        setNotice({ text: label, error: false });
        try {
          const message = await task();
          setNotice({ text: message, error: false });
          await load();
        } catch (error) {
          setNotice({ text: errorText(error), error: true });
        } finally {
          setBusy(false);
        }
      };

      const runLint = () => run("Linting\u2026", async () => {
        await apiGet(props.base, "/api/lint");
        return "Lint finished.";
      });

      const runHeal = () => run("Applying safe heal\u2026", async () => {
        const report = await apiPost(props.base, "/api/heal", {});
        setHeal(report);
        props.onSaved();
        return "Safe heal applied.";
      });

      const runVectors = (label, path) => run(label, async () => {
        const data = await apiPost(props.base, path, {});
        props.onSaved();
        return data && data.vectors
          ? label + " queued: " + (data.vectors.pending || 0) + " entries waiting."
          : label + " finished.";
      });

      const vectorAction = (label, path) => h(Btn, { size: "sm", disabled: busy, onClick: () => void runVectors(label, path) }, label);

      const issueList = (title, items, render) =>
        items && items.length
          ? h(
              "div",
              null,
              h("div", { className: "report-section-label" }, title + " \u00b7 " + items.length),
              h("div", { className: "issue-list" }, items.map(render)),
            )
          : null;

      const lintBody = !lint
        ? h(Loading, { text: "Loading lint report\u2026" })
        : h(
            "div",
            null,
            h(
              "div",
              { className: "chips" },
              h(Chip, null, h("span", { className: "faint" }, "entries"), h("strong", null, String(lint.totalCount))),
              h(Chip, null, h("span", { className: "faint" }, "active"), h("strong", null, String(lint.activeCount))),
              h(Chip, { tone: lint.brokenLinks.length ? "warn" : "" }, h("span", { className: "faint" }, "broken"), h("strong", null, String(lint.brokenLinks.length))),
              h(Chip, { tone: lint.overlaps.length ? "warn" : "" }, h("span", { className: "faint" }, "overlaps"), h("strong", null, String(lint.overlaps.length))),
              h(Chip, null, h("span", { className: "faint" }, "stale"), h("strong", null, String(lint.stale.length))),
            ),
            issueList("Broken links", lint.brokenLinks, (link) =>
              h("div", { key: link.id + ":" + link.field, className: "issue" },
                h("div", { className: "issue-title" }, link.title + " (" + link.id + ")"),
                h("div", { className: "issue-meta" }, link.field + " \u2192 missing " + link.missingId),
              ),
            ),
            issueList("Overlapping active pairs", lint.overlaps, (pair, index) =>
              h("div", { key: index, className: "issue" },
                h("div", { className: "issue-title" }, pair.aTitle + " \u2194 " + pair.bTitle),
                h("div", { className: "issue-meta" }, "common " + pair.common + " \u00b7 score " + pair.score),
              ),
            ),
            lint.overlapsHidden ? h("p", { className: "page-sub", style: { fontSize: "11.5px" } }, lint.overlapsHidden + " more pairs hidden by the cap.") : null,
            issueList("Stale entries", lint.stale, (entry) =>
              h("div", { key: entry.id, className: "issue" },
                h("div", { className: "issue-title" }, entry.title + " (" + entry.id + ")"),
                h("div", { className: "issue-meta" }, "updated " + datePart(entry.updatedAt)),
              ),
            ),
            !lint.brokenLinks.length && !lint.overlaps.length && !lint.stale.length
              ? h(Empty, { title: "Memory is clean", text: "No broken links, overlaps or stale entries." })
              : null,
          );

      const healBody = !heal
        ? h(Empty, { title: "No heal report yet", text: "Run self-healing to see what it changed." })
        : h(
            "div",
            null,
            h(
              "div",
              { className: "metric-line" },
              h("span", { className: "muted" }, "Removed broken links"),
              h("span", { className: "v" }, String(heal.removedLinks || 0)),
            ),
            h("div", { className: "metric-line" }, h("span", { className: "muted" }, "Added backlinks"), h("span", { className: "v" }, String(heal.addedBacklinks || 0))),
            h("div", { className: "metric-line" }, h("span", { className: "muted" }, "Reindexed entries"), h("span", { className: "v" }, String(heal.reindexed || 0))),
            h("div", { className: "metric-line" }, h("span", { className: "muted" }, "Broken links"), h("span", { className: "v" }, String(heal.brokenBefore || 0) + " \u2192 " + String(heal.brokenAfter || 0))),
            heal.vectors
              ? h(
                  "div",
                  null,
                  h("div", { className: "report-section-label" }, "Vectors"),
                  h("div", { className: "metric-line" }, h("span", { className: "muted" }, "Checked"), h("span", { className: "v" }, String(heal.vectors.checked || 0))),
                  h("div", { className: "metric-line" }, h("span", { className: "muted" }, "Leftovers removed"), h("span", { className: "v" }, String(heal.vectors.orphansRemoved || 0))),
                  h("div", { className: "metric-line" }, h("span", { className: "muted" }, "Metadata refreshed"), h("span", { className: "v" }, String(heal.vectors.metadataFixed || 0))),
                  h("div", { className: "metric-line" }, h("span", { className: "muted" }, "Damaged removed"), h("span", { className: "v" }, String(heal.vectors.badRemoved || 0))),
                  h("div", { className: "metric-line" }, h("span", { className: "muted" }, "Queued for embedding"), h("span", { className: "v" }, String(heal.vectors.queued || 0))),
                )
              : null,
          );

      const vectors = status && status.vectors;
      const vectorsBody = !vectors
        ? h(Empty, { title: "Vector search is off", text: "Enable the embeddings provider in Settings \u2192 LLM Memory." })
        : h(
            "div",
            null,
            h(
              "div",
              { className: "grid-kpi" },
              h(Stat, { label: "Embedded entries", value: vectors.entries }),
              h(Stat, { label: "Vectors", value: vectors.chunks }),
              h(Stat, { label: "Queue", value: vectors.pending }),
              h(Stat, { label: "This run", value: vectors.embedded }),
            ),
            h("div", { className: "metric-line mt-12" }, h("span", { className: "muted" }, "Model"), h("span", { className: "v" }, vectors.model || "\u2014")),
            h("div", { className: "metric-line" }, h("span", { className: "muted" }, "Backend"), h("span", { className: "v" }, vectors.backend || "\u2014")),
            h("div", { className: "metric-line" }, h("span", { className: "muted" }, "Storage"), h("span", { className: "v" }, formatByteSize(vectors.bytes))),
            vectors.lastError ? h("div", { className: "notice error mt-8" }, vectors.lastError) : null,
          );

      return h(
        "div",
        { className: "page" },
        h(PageHead, {
          title: "Health",
          sub: VIEW_SUBTITLES.health,
        }),
        h(
          "div",
          { className: "grid-2" },
          h(Card, {
            title: "Lint",
            sub: "Structural checks across the whole store.",
            actions: h(Btn, { size: "sm", disabled: busy, onClick: runLint }, "Lint now"),
            body: lintBody,
          }),
          h(Card, {
            title: "Self-healing",
            sub: "Safe fixes for links, backlinks and the vector queue.",
            actions: h(Btn, { size: "sm", disabled: busy, onClick: runHeal }, "Heal now"),
            body: healBody,
          }),
        ),
        h(Card, {
          className: "mt-16",
          title: "Semantic index",
          sub: "Embeddings, the queue and the model cache.",
          actions: h(
            "div",
            { className: "flex items-center gap-6" },
            vectorAction("Repair", "/api/vectors/repair"),
            vectorAction("Rebuild", "/api/vectors/rebuild"),
          ),
          body: vectorsBody,
        }),
        notice.text ? h("div", { className: "notice " + (notice.error ? "error" : ""), style: { marginTop: "12px" } }, notice.text) : null,
      );
    }

    /* ------------------------------------------------------------------ *
     * overlay
     * ------------------------------------------------------------------ */

    function Overlay(props) {
      const overlay = props.overlay;
      if (!overlay) return null;
      const close = props.onClose;
      let body;

      if (overlay.kind === "item") {
        const entry = overlay.entry;
        body = h(
          "div",
          null,
          h(
            "div",
            { className: "chips mb-8" },
            h(Badge, { tone: KIND_TONES[entry.kind] || "" }, entry.kind),
            h(Badge, { tone: entry.tier === "immutable" ? "danger" : entry.tier === "important" ? "warn" : "" }, entry.tier),
            h(Badge, { tone: entry.status === "active" ? "ok" : "" }, entry.status),
            h(Badge, null, entry.scope + (entry.project ? " / " + projectName(entry.project) : "")),
            h(Badge, null, "importance " + entry.importance),
          ),
          h("p", { className: "mono faint", style: { margin: "0 0 10px" } }, entry.id + " \u00b7 updated " + datePart(entry.updatedAt)),
          h("div", { style: { whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.6 } }, entry.text),
          entry.tags && entry.tags.length ? h("div", { className: "chips mt-12" }, entry.tags.map((tag) => h("span", { key: tag, className: "tag" }, tag))) : null,
        );
      } else if (overlay.kind === "confirm") {
        body = h("p", { className: "page-sub", style: { marginTop: 0 } }, overlay.message);
      } else {
        body = h("pre", { style: { whiteSpace: "pre-wrap", margin: 0 } }, overlay.text);
      }

      const title = overlay.kind === "item" ? overlay.entry.title || "(untitled)" : overlay.title;
      return h(
        "div",
        {
          className: "modal-backdrop",
          role: "dialog",
          "aria-label": title || VIEW_LABEL,
          onClick: (event) => {
            if (event.target === event.currentTarget) close();
          },
        },
        h(
          "div",
          { className: "modal" },
          h(
            "div",
            { className: "modal-head" },
            h("div", { className: "grow" }, h("h2", { className: "modal-title" }, title)),
            overlay.kind === "item" ? null : h(Btn, { size: "sm", variant: "ghost", onClick: close }, "Close"),
          ),
          h("div", { className: "modal-body" }, body),
          h(
            "div",
            { className: "modal-foot" },
            overlay.kind === "confirm"
              ? h(Btn, { variant: overlay.danger ? "danger" : "primary", onClick: overlay.onConfirm }, overlay.confirmLabel)
              : null,
            overlay.kind === "item"
              ? h(Btn, { onClick: () => props.onEdit(overlay.entry) }, "Edit")
              : null,
            overlay.kind === "item"
              ? h(Btn, { onClick: () => props.onForget(overlay.entry.id) }, "Forget")
              : null,
            overlay.kind === "item"
              ? h(Btn, { variant: "danger", onClick: () => props.onDelete(overlay.entry.id) }, "Delete")
              : null,
            h(Btn, { variant: overlay.kind === "item" ? "ghost" : "ghost", onClick: close }, overlay.kind === "confirm" ? "Cancel" : "Close"),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * conversation.view — root
     * ------------------------------------------------------------------ */

    function createMemoryView(scope) {
      return function MemoryView() {
        const [base, setBase] = React.useState(() => webBase(scope));
        const [tab, setTab] = React.useState("items");
        const [views, setViews] = React.useState([]);
        const [panelActions, setPanelActions] = React.useState([]);
        const [overlay, setOverlay] = React.useState(null);
        const [editDraft, setEditDraft] = React.useState(null);
        const [editKey, setEditKey] = React.useState(0);
        const [browseVersion, setBrowseVersion] = React.useState(0);
        const [projects, setProjects] = React.useState([]);
        const [actionStatus, setActionStatus] = React.useState({ text: "", error: false });
        const [busy, setBusy] = React.useState(false);
        const theme = useShellTheme();
        injectPanelStyles();

        React.useEffect(() => {
          const update = () => setBase(webBase(scope));
          update();
          let unsubscribe = null;
          try {
            unsubscribe = scope.subscribe(update);
          } catch (error) {
            unsubscribe = null;
          }
          return () => {
            if (unsubscribe) unsubscribe();
          };
        }, []);

        const refreshProjects = React.useCallback(async () => {
          try {
            const report = await apiGet(base, "/api/status");
            setProjects(Object.keys(report.byProject || {}).sort());
          } catch (error) {
            /* keep the previous project list when the status call fails */
          }
        }, [base]);

        React.useEffect(() => {
          refreshProjects();
          let alive = true;
          apiGet(base, "/api/ui/snapshot")
            .then((snapshot) => {
              if (!alive) return;
              const known = Array.isArray(snapshot.views) ? snapshot.views : [];
              setViews(known.filter((view) => DSH_VIEW_IDS.includes(view.id)));
              if (Array.isArray(snapshot.actions)) setPanelActions(snapshot.actions);
            })
            .catch(() => {
              /* keep the built-in order when the snapshot is unavailable */
            });
          return () => {
            alive = false;
          };
        }, [refreshProjects, base]);

        const refreshBrowse = () => setBrowseVersion((previous) => previous + 1);

        const openItem = async (id) => {
          try {
            const data = await apiGet(base, "/api/item?id=" + encodeURIComponent(id));
            setOverlay({ kind: "item", entry: data.item });
          } catch (error) {
            setActionStatus({ text: errorText(error), error: true });
          }
        };

        const editEntry = (entry) => {
          setEditDraft(entry || null);
          setEditKey((previous) => previous + 1);
          setTab("edit");
        };

        const forgetEntry = (id) => {
          setOverlay({
            kind: "confirm",
            title: "Forget memory entry",
            message: "Mark " + id + " as forgotten (superseded)?",
            confirmLabel: "Forget",
            onConfirm: async () => {
              setOverlay(null);
              try {
                await apiPost(base, "/api/forget", { id });
                refreshBrowse();
              } catch (error) {
                setActionStatus({ text: errorText(error), error: true });
              }
            },
          });
        };

        const deleteEntry = (id) => {
          setOverlay({
            kind: "confirm",
            title: "Delete memory entry",
            message: "Permanently delete " + id + "? This cannot be undone.",
            confirmLabel: "Delete",
            danger: true,
            onConfirm: async () => {
              setOverlay(null);
              try {
                await apiPost(base, "/api/delete", { id });
                refreshBrowse();
              } catch (error) {
                setActionStatus({ text: errorText(error), error: true });
              }
            },
          });
        };


        const handlers = {
          onOpen: openItem,
          onEdit: editEntry,
          onForget: forgetEntry,
          onDelete: deleteEntry,
        };

        const itemsView = views.find((view) => view.id === "items");
        const itemsTable = itemsView && (itemsView.widgets || []).find((widget) => widget.kind === "table");
        const itemsPagination = itemsTable && itemsTable.pagination;
        let content = null;
        if (tab === "overview") {
          content = h(StatusPanel, {
            base,
            version: browseVersion,
            projects,
            onOpen: openItem,
            onRefresh: refreshBrowse,
            onGoEntries: () => setTab("items"),
          });
        } else if (tab === "items") {
          content = h(BrowseTab, {
            base,
            version: browseVersion,
            projects,
            handlers,
            pagination: itemsPagination,
            onNew: () => {
              setEditDraft(null);
              setEditKey((previous) => previous + 1);
              setTab("editor");
            },
          });
        } else if (tab === "editor") {
          content = h(EditTab, { key: editKey, base, draft: editDraft, onSaved: refreshBrowse });
        } else if (tab === "graph") {
          content = h(GraphTab, { base, onOpen: openItem });
        } else if (tab === "map") {
          content = h(MapTab, { base, onOpen: openItem });
        } else if (tab === "recall") {
          content = h(RecallTab, { base, onOpen: openItem });
        } else {
          content = h(HealthTab, { base, onSaved: refreshBrowse });
        }

        return h(
          "div",
          { className: "lm-panel", "data-theme": theme, style: { height: "100%", overflow: "auto" } },
          h(
            "div",
            { className: "lm-top" },
            h(Notice, { text: actionStatus.text, error: actionStatus.error }),
            h(
              Btn,
              { variant: "ghost", size: "sm", disabled: busy, onClick: refreshBrowse, title: "Refresh" },
              "Refresh",
            ),
          ),
          h(
            "nav",
            { className: "lm-tabs", role: "tablist" },
            views.map((view) =>
              h(
                "button",
                {
                  key: view.id,
                  type: "button",
                  role: "tab",
                  "aria-selected": tab === view.id ? "true" : "false",
                  className: tab === view.id ? "lm-tab active" : "lm-tab",
                  onClick: () => setTab(view.id),
                },
                view.title,
              ),
            ),
          ),
          h("div", { className: "content" }, content),
          h(Overlay, {
            overlay,
            busy,
            onClose: () => setOverlay(null),
            onEdit: editEntry,
            onForget: forgetEntry,
            onDelete: deleteEntry,
          }),
        );
      };
    }

    /* ------------------------------------------------------------------ *
     * settings.section — dedicated entry in the Settings left menu
     * ------------------------------------------------------------------ */


    /**
     * Settings fields rendered from the universal schema served by the plugin:
     * one source of truth for every panel (dsh, Kilo, OpenCode, MCP).
     */
    function SchemaSettings({ form, update, scope }) {
      const [schema, setSchema] = React.useState(null);
      const [error, setError] = React.useState(null);
      React.useEffect(() => {
        let alive = true;
        fetch(webBase(scope) + "/api/settings/schema")
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error("HTTP " + response.status))))
          .then((data) => { if (alive) setSchema(data); })
          .catch((failure) => { if (alive) setError(errorText(failure)); });
        return () => { alive = false; };
      }, [scope]);
      if (error) return h("p", { style: S.status }, "Settings schema is unavailable: " + error);
      if (!schema) return h("p", { style: S.hint }, "Loading settings schema\u2026");
      return h(
        "div",
        null,
        (schema.groups || []).map((group) =>
          h(
            "div",
            { key: group.id },
            h("h3", { style: S.sectionTitle }, group.title),
            group.fields.map((field) => {
              if (field.key === undefined) {
                return h(
                  Field,
                  { key: field.path, label: field.label, hint: field.hint + " (Not exposed by the dsh settings service.)" },
                  h("input", { type: "text", style: S.input, value: "", disabled: true }),
                );
              }
              const key = field.key;
              const value = form[key];
              if (field.type === "boolean") {
                return h(
                  "label",
                  { key: field.path, style: Object.assign({}, S.status, { display: "flex", gap: "6px", alignItems: "center" }) },
                  h("input", {
                    type: "checkbox",
                    style: undefined,
                    checked: !!value,
                    onChange: (event) => update(key, event.target.checked),
                  }),
                  h("span", null, field.label),
                );
              }
              if (field.type === "select") {
                return h(
                  Field,
                  { key: field.path, label: field.label, hint: field.hint },
                  h(
                    "select",
                    { style: S.input, value: value === undefined ? "" : String(value), onChange: (event) => update(key, event.target.value) },
                    (field.options || []).map((option) => h("option", { key: option.value, style: S.option, value: option.value }, option.label)),
                  ),
                );
              }
              if (field.type === "textarea" || field.type === "list") {
                const text = field.type === "list" ? (Array.isArray(value) ? value.join("\n") : "") : (value === undefined ? "" : String(value));
                return h(
                  Field,
                  { key: field.path, label: field.label, hint: field.hint },
                  h("textarea", {
                    style: Object.assign({}, S.input, { minHeight: "64px" }),
                    value: text,
                    onChange: (event) =>
                      update(
                        key,
                        field.type === "list" ? event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) : event.target.value,
                      ),
                  }),
                );
              }
              return h(
                Field,
                { key: field.path, label: field.label, hint: field.hint },
                h("input", {
                  type: field.type === "number" ? "number" : "text",
                  ...(field.min !== undefined ? { min: field.min } : {}),
                  ...(field.max !== undefined ? { max: field.max } : {}),
                  ...(field.step !== undefined ? { step: field.step } : {}),
                  style: S.input,
                  value: value === undefined ? "" : value,
                  onChange: (event) => update(key, event.target.value),
                }),
              );
            }),
          ),
        ),
      );
    }

    function createSettingsCard(scope) {
      return function SettingsCard() {
        const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot());
        const [form, setForm] = React.useState(() => toForm(snapshot.value));
        const [notice, setNotice] = React.useState("");
        const [report, setReport] = React.useState("");
        const [busy, setBusy] = React.useState(false);
        const [model, setModel] = React.useState(null);
        const [modelBusy, setModelBusy] = React.useState(false);
        const { byId: actionById } = useUIActions(scope);

        const loadModelStatus = React.useCallback(async () => {
          try {
            const data = await apiGet(webBase(scope), "/api/model/status");
            setModel(data && typeof data === "object" ? data : null);
          } catch (error) {
            setModel(null);
          }
        }, []);

        const downloading = model !== null && model.downloading === true;
        React.useEffect(() => {
          loadModelStatus();
        }, []);
        React.useEffect(() => {
          if (!downloading) return undefined;
          const timer = setInterval(() => {
            loadModelStatus();
          }, 1500);
          return () => clearInterval(timer);
        }, [downloading]);

        const downloadModel = async () => {
          setModelBusy(true);
          setNotice("Starting the model download\u2026");
          try {
            const data = await apiPost(webBase(scope), "/api/model/download", {});
            if (data && typeof data === "object") setModel(data);
            setNotice("Model download started \u2014 progress is shown under the model field.");
          } catch (error) {
            setNotice("Model download failed: " + errorText(error));
          } finally {
            setModelBusy(false);
          }
        };

        const removeModel = async () => {
          if (
            !window.confirm("Delete the cached embedding model? The next semantic search downloads it again.")
          ) {
            return;
          }
          setModelBusy(true);
          try {
            const data = await apiPost(webBase(scope), "/api/model/remove", {});
            if (data && typeof data === "object") setModel(data);
            setNotice("Cached model deleted.");
          } catch (error) {
            setNotice("Deleting the model failed: " + errorText(error));
          } finally {
            setModelBusy(false);
          }
        };

        React.useEffect(() => {
          const onChange = () => setSnapshot(scope.getSnapshot());
          let unsubscribe = null;
          try {
            unsubscribe = scope.subscribe(onChange);
          } catch (error) {
            unsubscribe = null;
          }
          onChange();
          return () => {
            if (unsubscribe) unsubscribe();
          };
        }, []);

        React.useEffect(() => {
        }, []);

        React.useEffect(() => {
          setForm(toForm(snapshot.value));
        }, [snapshot.status, snapshot.revision]);

        const update = (field, value) =>
          setForm((previous) => Object.assign({}, previous, { [field]: value }));

        const save = async () => {
          setBusy(true);
          setNotice("Saving settings\u2026");
          try {
            await scope.set("storageRoot", String(form.storageRoot || ""));
            await scope.set("recallLimit", intValue(form.recallLimit, 10, 1, 1000));
            await scope.set("autonomous", !!form.autonomous);
            await scope.set("requireConfirmation", !!form.requireConfirmation);
            await scope.set("systemPrompt", String(form.systemPrompt || ""));
            await scope.set(
              "lintOverlapMinCommonWords",
              intValue(form.lintOverlapMinCommonWords, 8, 1, 1000),
            );
            await scope.set("lintMaxPairs", intValue(form.lintMaxPairs, 200, 0, 100000));
            await scope.set("recallTextChars", intValue(form.recallTextChars, 400, 0, 100000));
            await scope.set("recallTotalChars", intValue(form.recallTotalChars, 12000, 500, 1000000));
            await scope.set(
              "recallFormat",
              oneOf(form.recallFormat, ["markdown", "table", "timeline", "json"], "markdown"),
            );
            await scope.set("recallAllowFormatOverride", form.recallAllowFormatOverride !== false);
            await scope.set("recallLiteralLookup", form.recallLiteralLookup !== false);
            await scope.set("promptRulesLimit", intValue(form.promptRulesLimit, 6, 1, 100));
            await scope.set("rulesPromptScope", oneOf(form.rulesPromptScope, ["project", "all"], "project"));
            await scope.set("projectScanBudgetMs", intValue(form.projectScanBudgetMs, 0, 0, 600000));
            await scope.set("embeddingsProvider", oneOf(form.embeddingsProvider, ["off", "local", "http"], "local"));
            await scope.set("embeddingsModel", String(form.embeddingsModel || "Xenova/multilingual-e5-small"));
            await scope.set("embeddingsDim", intValue(form.embeddingsDim, 384, 64, 4096));
            await scope.set("embeddingsBackend", oneOf(form.embeddingsBackend, ["off", "js", "sqlite-vec"], "js"));
            await scope.set(
              "embeddingsQuantization",
              oneOf(form.embeddingsQuantization, ["float", "int8", "bit"], "float"),
            );
            await scope.set("embeddingsTopK", intValue(form.embeddingsTopK, 50, 5, 500));
            await scope.set("embeddingsMinScore", floatValue(form.embeddingsMinScore, 0, 0, 1));
            await scope.set("embeddingsBatchSize", intValue(form.embeddingsBatchSize, 16, 1, 256));
            await scope.set("embeddingsChunkChars", intValue(form.embeddingsChunkChars, 800, 200, 8000));
            await scope.set("embeddingsChunkOverlap", intValue(form.embeddingsChunkOverlap, 120, 0, 4000));
            await scope.set(
              "embeddingsSemanticEdgesPerEntry",
              intValue(form.embeddingsSemanticEdgesPerEntry, 3, 1, 20),
            );
            await scope.set(
              "embeddingsSemanticMaxEdges",
              intValue(form.embeddingsSemanticMaxEdges, 300, 10, 10000),
            );
            await scope.set("embeddingsPrewarm", !!form.embeddingsPrewarm);
            await scope.set("webPath", String(form.webPath || DEFAULT_WEB_PATH));
            setNotice("Settings saved.");
          } catch (error) {
            setNotice("Save failed: " + errorText(error));
          } finally {
            setBusy(false);
          }
        };

        const status = snapshot.status;
        const statusNote =
          status === "ready"
            ? null
            : status === "loading"
              ? "Loading current settings\u2026"
              : "The dsh settings service is unavailable; changes cannot be saved in this client.";

        const inputProps = (field) => ({
          type: "text",
          style: S.input,
          value: form[field],
          onChange: (event) => update(field, event.target.value),
        });

        return h(
          "div",
          { style: S.cardColumn },
          h("div", null, [
            h("h2", { key: "title", style: S.overlayTitle }, "LLM Memory"),
            h(
              "p",
              { key: "hint", style: S.hint },
              "Layered long-term memory: storage, recall, autonomy and import roots. The system prompt is injected into the agent on every turn.",
            ),
            statusNote ? h("p", { key: "status", style: S.hint }, statusNote) : null,
          ]),
          h(SchemaSettings, { form, update, scope }),
          h("h3", { style: S.sectionTitle }, "Embedding model"),
          h("p", { style: S.hint }, modelStatusText(model)),
          h(
            "div",
            { style: S.actions },
            actionById["model.status"] ? h("button", { type: "button", style: S.button, disabled: modelBusy, onClick: loadModelStatus }, actionById["model.status"].label) : null,
            actionById["model.download"] ? h("button", { type: "button", style: S.primary, disabled: modelBusy || downloading, onClick: downloadModel }, actionById["model.download"].label) : null,
            actionById["model.remove"] ? h("button", { type: "button", style: S.button, disabled: modelBusy, onClick: removeModel }, actionById["model.remove"].label) : null,
          ),
          h(BackupSection, { scope }),
          h(
            "div",
            { style: S.actions },
            h("button", { type: "button", style: S.primary, disabled: busy, onClick: save }, "Save settings"),
          ),
          notice ? h("p", { style: S.status }, notice) : null,
          report ? h("pre", { style: S.pre }, report) : null,
        );
      };
    }


    function BackupSection({ scope }) {
      const base = webBase(scope);
      const { byId } = useUIActions(scope);
      const [backups, setBackups] = React.useState([]);
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState("");

      const reload = React.useCallback(async () => {
        try {
          const data = await apiGet(base, "/api/backup");
          setBackups(Array.isArray(data) ? data : []);
        } catch (error) {
          setNotice("Backup list failed: " + errorText(error));
        }
      }, [base]);

      React.useEffect(() => {
        reload();
      }, [reload]);

      const call = async (operation, extra) => {
        setBusy(true);
        setNotice("");
        try {
          const result = await apiPost(base, "/api/backup", Object.assign({ operation }, extra || {}));
          setNotice(operation.replace("backup.", "") + ": " + JSON.stringify(result));
          await reload();
        } catch (error) {
          setNotice(operation + " failed: " + errorText(error));
        } finally {
          setBusy(false);
        }
      };

      const create = () => call("backup.create");
      const verify = (archive) => call("backup.verify", { archive });
      const restore = (archive) => {
        const word = window.prompt('Type RESTORE to restore ' + archive);
        if (word === "RESTORE") call("backup.restore", { archive, confirm: word });
      };
      const remove = (archive) => {
        const word = window.prompt('Type DELETE to remove ' + archive);
        if (word === "DELETE") call("backup.delete", { archive, confirm: word });
      };

      return h(
        "section",
        { style: S.section },
        h("h3", { style: S.sectionTitle }, "Backup"),
        h(
          "p",
          { style: S.hint },
          "Manual .llmmem snapshots of the memory store (database, pages, raw digests, config). Restore and delete require typed confirmation.",
        ),
        h(
          "div",
          { style: S.actions },
          byId["backup.create"] ? h("button", { type: "button", style: S.primary, disabled: busy, onClick: create }, byId["backup.create"].label) : null,
          byId["backup.list"] ? h("button", { type: "button", style: S.button, disabled: busy, onClick: reload }, byId["backup.list"].label) : null,
        ),
        backups.length === 0
          ? h("p", { style: S.hint }, "No backups yet.")
          : h(
              "ul",
              { style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" } },
              backups.map((item) =>
                h(
                  "li",
                  { key: item.archive || item.name, style: S.field },
                  h("div", { style: S.hint }, String(item.name || item.archive) + " — " + String(item.createdAt || "") + " — " + String(item.bytes || item.sizeBytes || 0) + " bytes" + (item.encrypted ? " (encrypted)" : "")),
                  h(
                    "div",
                    { style: S.actions },
                    byId["backup.verify"] ? h("button", { type: "button", style: S.button, disabled: busy, onClick: () => verify(item.archive) }, byId["backup.verify"].label) : null,
                    byId["backup.restore"] ? h("button", { type: "button", style: S.button, disabled: busy, onClick: () => restore(item.archive) }, byId["backup.restore"].label) : null,
                    byId["backup.delete"] ? h("button", { type: "button", style: S.button, disabled: busy, onClick: () => remove(item.archive) }, byId["backup.delete"].label) : null,
                  ),
                ),
              ),
            ),
        notice ? h("p", { style: S.status }, notice) : null,
      );
    }


    /* ------------------------------------------------------------------ *
     * plugin entry
     * ------------------------------------------------------------------ */

    function apply(rawContext) {
      const ctx = rawContext;
      let scope = null;
      try {
        // dsh 0.1.7 replaced the client `settingsScope` service: the entry's
        // values and write queue now come from the shared configuration form
        // provider, keyed by the Host entry id (this plugin's own namespace).
        scope = ctx.configForms.get(NAMESPACE);
      } catch (error) {
        scope = null;
      }
      if (!scope) scope = unavailableScope();

      const MemoryView = createMemoryView(scope);
      const SettingsCard = createSettingsCard(scope);

      ctx.slots.inject("conversation.view", () =>
        ctx.slots.register(
          { name: "conversation.view", id: VIEW_ID, order: ORDER, label: () => VIEW_LABEL },
          MemoryView,
        ),
      );

      // A dedicated Settings entry (left menu), not a card inside Plugins.
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          { name: "settings.section", id: VIEW_ID, order: 20, label: () => VIEW_LABEL },
          SettingsCard,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
