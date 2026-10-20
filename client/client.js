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
        importRoots: Array.isArray(v.importRoots) ? v.importRoots.join("\n") : "",
        importAutoDetect: v.importAutoDetect !== false,
        rulesSource: v.rulesSource === "kilo-verbatim" ? "kilo-verbatim" : "bundled-en",
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
        gap: "8px",
        alignItems: "center",
        padding: "10px 12px",
        borderBottom: "1px solid " + T.border1,
        flex: "0 0 auto",
      },
      toolbarSpacer: { flex: "1 1 auto" },
      status: { fontSize: "12px", color: T.secondary, whiteSpace: "pre-wrap" },
      tabs: {
        display: "flex",
        flexWrap: "wrap",
        gap: "2px",
        padding: "6px 8px 0",
        borderBottom: "1px solid " + T.border1,
        flex: "0 0 auto",
      },
      tab: {
        background: "transparent",
        color: T.secondary,
        border: "1px solid transparent",
        borderBottom: "none",
        borderRadius: "8px 8px 0 0",
        padding: "6px 12px",
        fontSize: "12px",
        cursor: "pointer",
        font: "inherit",
      },
      tabActive: {
        background: T.bg2,
        color: T.text,
        border: "1px solid " + T.border1,
        borderBottom: "none",
        borderRadius: "8px 8px 0 0",
        padding: "6px 12px",
        fontSize: "12px",
        cursor: "pointer",
        font: "inherit",
      },
      content: { flex: "1 1 auto", overflow: "auto", padding: "12px" },
      input: {
        background: T.bg1,
        color: T.text,
        border: "1px solid " + T.border2,
        borderRadius: "6px",
        padding: "5px 8px",
        fontSize: "12px",
        minWidth: "120px",
        font: "inherit",
      },
      option: { background: T.menu, color: T.text },
      button: {
        background: "transparent",
        color: T.text,
        border: "1px solid " + T.border2,
        borderRadius: "6px",
        padding: "5px 10px",
        fontSize: "12px",
        cursor: "pointer",
        font: "inherit",
      },
      primary: {
        background: T.bg3,
        color: T.text,
        border: "1px solid " + T.business,
        borderRadius: "6px",
        padding: "5px 10px",
        fontSize: "12px",
        cursor: "pointer",
        font: "inherit",
      },
      danger: {
        background: "transparent",
        color: T.danger,
        border: "1px solid " + T.danger,
        borderRadius: "6px",
        padding: "5px 10px",
        fontSize: "12px",
        cursor: "pointer",
        font: "inherit",
      },
      disabled: { opacity: 0.5, cursor: "not-allowed" },
      field: { display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" },
      label: { fontSize: "12px", color: T.secondary },
      hint: { fontSize: "11px", color: T.caption, lineHeight: 1.45 },
      row: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" },
      actions: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginTop: "8px" },
      panel: {
        background: T.bg1,
        border: "1px solid " + T.border1,
        borderRadius: "8px",
        padding: "12px",
        marginBottom: "12px",
      },
      card: {
        background: T.bg1,
        border: "1px solid " + T.border1,
        borderRadius: "8px",
        padding: "12px",
      },
      grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: "10px",
      },
      cardTitle: { margin: "0 0 4px", fontSize: "13px", fontWeight: 600, color: T.text },
      meta: { fontSize: "11px", color: T.caption, wordBreak: "break-all", marginBottom: "6px" },
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
        maxHeight: "160px",
        overflow: "auto",
        fontSize: "12px",
        color: T.secondary,
        margin: "0 0 4px",
      },
      kpis: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: "10px",
        marginBottom: "12px",
      },
      kpi: { background: T.bg2, border: "1px solid " + T.border1, borderRadius: "8px", padding: "10px" },
      kpiNum: { fontSize: "20px", fontWeight: 600, color: T.text },
      kpiLabel: { fontSize: "11px", color: T.caption },
      sectionTitle: { margin: "14px 0 6px", fontSize: "13px", fontWeight: 600, color: T.text },
      bars: { display: "grid", gap: "5px" },
      bar: { display: "grid", gridTemplateColumns: "120px 1fr 40px", gap: "8px", alignItems: "center", fontSize: "12px" },
      barTrack: { background: T.bg2, border: "1px solid " + T.border1, borderRadius: "6px", height: "12px", overflow: "hidden", display: "block" },
      barFill: { display: "block", minWidth: "2px", height: "100%", borderRadius: "5px", background: T.business },
      pre: {
        background: T.code,
        border: "1px solid " + T.border1,
        borderRadius: "6px",
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
        borderRadius: "12px",
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
        borderRadius: "8px",
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
        { style: S.field },
        h("span", { style: S.label }, props.label),
        props.children,
        props.hint ? h("small", { style: S.hint }, props.hint) : null,
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
        h("div", { style: S.kpiNum }, String(props.value)),
        h("div", { style: S.kpiLabel }, props.label),
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

    function entryCard(entry, handlers) {
      return h(
        "div",
        { key: entry.id, style: S.card },
        h("h3", { style: S.cardTitle }, entry.title || "(untitled)"),
        h("div", { style: S.meta }, entry.id + " \u00b7 updated " + datePart(entry.updatedAt)),
        h(
          "div",
          { style: S.pills },
          h(Pill, { tone: KIND_COLORS[entry.kind] }, entry.kind),
          h(Pill, null, entry.scope + (entry.project ? "/" + entry.project : "")),
          h(Pill, null, entry.status),
          h(Pill, null, entry.tier),
          h(Pill, null, "imp " + entry.importance),
        ),
        entry.tags && entry.tags.length ? h("div", { style: S.meta }, "tags: " + entry.tags.join(", ")) : null,
        h("div", { style: S.text }, entry.text),
        h(
          "div",
          { style: S.actions },
          h("button", { type: "button", style: S.button, onClick: () => handlers.onOpen(entry.id) }, "View"),
          h("button", { type: "button", style: S.button, onClick: () => handlers.onEdit(entry) }, "Edit"),
          h("button", { type: "button", style: S.button, onClick: () => handlers.onForget(entry.id) }, "Forget"),
          h("button", { type: "button", style: S.danger, onClick: () => handlers.onDelete(entry.id) }, "Delete"),
        ),
      );
    }

    function BrowseTab(props) {
      const [query, setQuery] = React.useState("");
      const [kind, setKind] = React.useState("");
      const [scope, setScope] = React.useState("");
      const [status, setStatus] = React.useState("");
      const [project, setProject] = React.useState("");
      const pagination = props.pagination || { pageSizes: [12, 24, 48, 96], defaultPageSize: 24 };
      const [pageSize, setPageSize] = React.useState(String(pagination.defaultPageSize));
      const [page, setPage] = React.useState(0);
      const [reload, setReload] = React.useState(0);
      const [items, setItems] = React.useState(null);
      const [total, setTotal] = React.useState(0);
      const [error, setError] = React.useState("");

      const load = React.useCallback(async () => {
        const params = new URLSearchParams();
        if (query.trim()) params.set("query", query.trim());
        if (kind) params.set("kind", kind);
        if (scope) params.set("scope", scope);
        if (status) params.set("status", status);
        if (project.trim()) params.set("project", project.trim());
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
      }, [props.base, query, kind, scope, status, project, pageSize, page]);

      React.useEffect(() => {
        load();
      }, [props.version, page, pageSize, reload]);

      const select = (value, setter, options, label) =>
        h(
          Field,
          { label },
          h(
            "select",
            { style: S.input, value, onChange: (event) => setter(event.target.value) },
            h("option", { style: S.option, value: "" }, "any"),
            options.map((option) => h("option", { key: option, style: S.option, value: option }, option)),
          ),
        );

      return h(
        "div",
        null,
        h(
          "div",
          { style: S.panel },
          h(
            "div",
            { style: S.row },
            h(
              Field,
              { label: "Query" },
              h("input", {
                type: "text",
                style: S.input,
                placeholder: "search title, text, tags",
                value: query,
                onChange: (event) => setQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") load();
                },
              }),
            ),
            select(kind, setKind, KINDS, "Kind"),
            select(scope, setScope, ["project", "user"], "Scope"),
            select(status, setStatus, ["active", "superseded", "archived"], "Status"),
            h(
              Field,
              { label: "Project" },
              h(
                "select",
                { style: S.input, value: project, onChange: (event) => setProject(event.target.value) },
                h("option", { style: S.option, value: "" }, "any"),
                (props.projects || []).map((key) => h("option", { key, style: S.option, value: key }, key)),
              ),
            ),
            h(
              Field,
              { label: "Per page" },
              h(
                "select",
                {
                  style: S.input,
                  value: pageSize,
                  onChange: (event) => {
                    setPage(0);
                    setPageSize(event.target.value);
                  },
                },
                pagination.pageSizes.map((size) =>
                  h("option", { key: size, style: S.option, value: String(size) }, String(size)),
                ),
              ),
            ),
            h(
              "button",
              {
                type: "button",
                style: S.primary,
                onClick: () => {
                  setPage(0);
                  setReload((value) => value + 1);
                },
              },
              "Search",
            ),
          ),
        ),
        h(
          "div",
          { style: S.meta },
          error
            ? error
            : items === null
              ? "Loading\u2026"
              : total + " entr" + (total === 1 ? "y" : "ies") + (query.trim() ? ' matching "' + query.trim() + '"' : ""),
        ),
        error ? null : h("div", { style: S.grid }, (items || []).map((entry) => entryCard(entry, props.handlers))),
        error
          ? null
          : h(
              "div",
              { style: S.meta },
              h("button", {
                type: "button",
                style: S.button,
                disabled: page === 0,
                onClick: () => setPage((value) => Math.max(0, value - 1)),
              }, "Previous"),
              h(
                "span",
                { style: { margin: "0 10px" } },
                "Page " + (page + 1) + " of " + Math.max(1, Math.ceil(total / Number(pageSize))),
              ),
              h("button", {
                type: "button",
                style: S.button,
                disabled: (page + 1) * Number(pageSize) >= total,
                onClick: () => setPage((value) => value + 1),
              }, "Next"),
            ),
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
            { style: S.input, value, onChange: (event) => setter(event.target.value) },
            options.map((option) => h("option", { key: option, style: S.option, value: option }, option)),
          ),
        );

      return h(
        "div",
        { style: S.panel },
        h("h3", { style: S.cardTitle }, form.id ? "Edit memory entry " + form.id : "Create a memory entry"),
        h(
          "div",
          { style: S.grid },
          h(
            Field,
            { label: "Title" },
            h("input", {
              type: "text",
              style: S.input,
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
              type: "text",
              style: S.input,
              value: form.project,
              onChange: (event) => update("project", event.target.value),
            }),
          ),
          selectField("Tier", form.tier, (value) => update("tier", value), ["normal", "important", "immutable"]),
          h(
            Field,
            { label: "Importance (1-5)" },
            h("input", {
              type: "number",
              min: 1,
              max: 5,
              style: S.input,
              value: form.importance,
              onChange: (event) => update("importance", event.target.value),
            }),
          ),
          h(
            Field,
            { label: "Tags (comma separated)" },
            h("input", {
              type: "text",
              style: S.input,
              value: form.tags,
              onChange: (event) => update("tags", event.target.value),
            }),
          ),
          h(
            Field,
            { label: "Keywords" },
            h("input", {
              type: "text",
              style: S.input,
              value: form.keywords,
              onChange: (event) => update("keywords", event.target.value),
            }),
          ),
        ),
        h(
          Field,
          { label: "Text" },
          h("textarea", {
            style: Object.assign({}, S.input, { minHeight: "96px", width: "100%", resize: "vertical" }),
            value: form.text,
            onChange: (event) => update("text", event.target.value),
          }),
        ),
        h(
          Field,
          { label: "Supersedes (comma separated ids)" },
          h("input", {
            type: "text",
            style: S.input,
            value: form.supersedes,
            onChange: (event) => update("supersedes", event.target.value),
          }),
        ),
        h(
          Field,
          { label: "Related (comma separated ids)" },
          h("input", {
            type: "text",
            style: S.input,
            value: form.related,
            onChange: (event) => update("related", event.target.value),
          }),
        ),
        h(
          "div",
          { style: S.actions },
          h("button", { type: "button", style: S.primary, disabled: busy, onClick: save }, "Save"),
          h("button", { type: "button", style: S.button, disabled: busy, onClick: reset }, "Reset"),
          h(Notice, { text: status.text, error: status.error }),
        ),
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
        null,
        h(
          "div",
          { style: S.panel },
          h(
            "div",
            { style: S.legend },
            KINDS.map((kind) =>
              h(
                "span",
                { key: kind },
                h("i", { style: Object.assign({}, S.legendDot, { background: KIND_COLORS[kind] }) }),
                kind,
              ),
            ),
          ),
          error
            ? h("p", { style: Object.assign({}, S.hint, { color: T.danger }) }, error)
            : h(
                "div",
                { style: S.graphBox },
                h(
                  "svg",
                  {
                    ref: svgRef,
                    style: S.graphSvg,
                    onMouseDown,
                    onClick,
                  },
                  children,
                ),
                h("div", { style: S.graphHint }, "Wheel to zoom \u00b7 drag to pan \u00b7 click a node for details"),
              ),
        ),
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

      return h(
        "div",
        null,
        h(
          "p",
          { style: S.hint },
          map
            ? "Entries placed by the two leading principal components of their embeddings: close points mean similar " +
              "meaning. The axes carry " +
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
          { style: S.toolbar },
          h("label", { style: S.label }, "Colour"),
          h(
            "select",
            { style: S.input, value: colorBy, onChange: (event) => setColorBy(event.target.value) },
            [
              ["project", "by project"],
              ["kind", "by kind"],
            ].map(([value, text]) => h("option", { key: value, style: S.option, value }, text)),
          ),
          h("label", { style: S.label }, "Status"),
          h(
            "select",
            { style: S.input, value: statusFilter, onChange: (event) => setStatusFilter(event.target.value) },
            [
              ["active", "active"],
              ["superseded", "superseded"],
              ["archived", "archived"],
              ["all", "all"],
            ].map(([value, text]) => h("option", { key: value, style: S.option, value }, text)),
          ),
          h("label", { style: S.label }, "Kind"),
          h(
            "select",
            { style: S.input, value: kindFilter, onChange: (event) => setKindFilter(event.target.value) },
            [["", "any"]]
              .concat(KINDS.map((kind) => [kind, kind]))
              .map(([value, text]) => h("option", { key: value, style: S.option, value }, text)),
          ),
          h("label", { style: S.label }, "Project"),
          h(
            "select",
            { style: S.input, value: projectFilter, onChange: (event) => setProjectFilter(event.target.value) },
            [["", "any"]]
              .concat(projects.map((project) => [project, project]))
              .map(([value, text]) => h("option", { key: value, style: S.option, value }, text)),
          ),
          h("label", { style: S.label }, "Scope"),
          h(
            "select",
            { style: S.input, value: scopeFilter, onChange: (event) => setScopeFilter(event.target.value) },
            [
              ["", "any"],
              ["project", "project"],
              ["user", "user"],
            ].map(([value, text]) => h("option", { key: value, style: S.option, value }, text)),
          ),
          h("span", { style: S.toolbarSpacer }),
          h(
            "button",
            { type: "button", style: S.button, disabled: busy, onClick: () => load(true) },
            busy ? "Rebuilding\u2026" : "Refresh",
          ),
          h("button", { type: "button", style: S.button, onClick: () => zoomBy(1.25) }, "Zoom +"),
          h("button", { type: "button", style: S.button, onClick: () => zoomBy(0.8) }, "Zoom \u2212"),
          h("button", { type: "button", style: S.button, onClick: resetView }, "Reset view"),
        ),
        map
          ? h(
              "div",
              { style: S.toolbar },
              h("label", { style: S.label }, "Place a query"),
              h("input", {
                style: Object.assign({}, S.input, { minWidth: "280px", flex: "1 1 280px" }),
                type: "text",
                value: queryText,
                placeholder: "Free text: where does recall look?",
                onChange: (event) => setQueryText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") placeQuery();
                },
              }),
              h("button", { type: "button", style: S.button, onClick: placeQuery }, "Show on map"),
              placed
                ? h(
                    "button",
                    {
                      type: "button",
                      style: S.button,
                      onClick: () => {
                        setPlaced(null);
                        setQueryNote("");
                      },
                    },
                    "Clear",
                  )
                : null,
            )
          : null,
        queryNote ? h("p", { style: S.hint }, queryNote) : null,
        error ? h("p", { style: Object.assign({}, S.hint, { color: T.danger }) }, error) : null,
        map
          ? h(
              "div",
              null,
              h(
                "div",
                { style: S.legend },
                legendValues.map((value) =>
                  h(
                    "span",
                    { key: value },
                    h("i", {
                      style: Object.assign({}, S.legendDot, {
                        background: colorBy === "kind" ? KIND_COLORS[value] || T.tertiary : mapProjectColor(value),
                      }),
                    }),
                    value,
                  ),
                ),
                h("span", null, visible.length + " of " + points.length + " points shown"),
              ),
              h(
                "div",
                { style: S.graphBox, ref: wrapRef },
                h("canvas", {
                  ref: canvasRef,
                  style: {
                    width: "100%",
                    height: MAP_HEIGHT + "px",
                    background: T.bg1,
                    border: "1px solid " + T.border1,
                    borderRadius: "8px",
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
                          padding: "6px 8px",
                          fontSize: "11px",
                          lineHeight: "1.35",
                          color: T.text,
                          background: T.bg2,
                          border: "1px solid " + T.border1,
                          borderRadius: "6px",
                          pointerEvents: "none",
                        },
                      },
                      hover.point.title || hover.point.id,
                      h("div", { style: { color: T.secondary } }, hover.point.kind + " \u00b7 " + hover.point.project),
                      h(
                        "div",
                        { style: { color: T.caption } },
                        hover.point.chunks +
                          (hover.point.chunks === 1 ? " chunk" : " chunks") +
                          (hover.point.status === "active" ? "" : " \u00b7 " + hover.point.status),
                      ),
                    )
                  : null,
                h(
                  "div",
                  { style: S.graphHint },
                  "Wheel to zoom \u00b7 drag to pan \u00b7 click a point for details \u00b7 double click to reset",
                ),
              ),
            )
          : h("p", { style: S.hint }, reason ? reasonText[reason] || reason : "Loading the map\u2026"),
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

      const legs = (item) => (item.sources || []).map((leg) => h("span", { key: leg, style: S.pill }, leg));

      return h(
        "div",
        null,
        h(
          "p",
          { style: S.hint },
          "Runs llm_memory_recall the way the agent calls it and shows both sides: which legs brought each entry in, " +
            "and the exact text the agent received. The format is the settings default unless you pick one here.",
        ),
        h(
          "div",
          { style: S.toolbar },
          h("label", { style: S.label }, "Query"),
          h("input", {
            style: Object.assign({}, S.input, { minWidth: "280px", flex: "1 1 280px" }),
            type: "text",
            value: query,
            placeholder: "Free text, as the agent would ask",
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter") run();
            },
          }),
          h("label", { style: S.label }, "Format"),
          h(
            "select",
            { style: S.input, value: format, onChange: (event) => setFormat(event.target.value) },
            [["", "settings default"]]
              .concat(RECALL_FORMATS.map((item) => [item, item]))
              .map(([value, text]) => h("option", { key: value, style: S.option, value }, text)),
          ),
          h(
            "button",
            { type: "button", style: S.button, disabled: busy, onClick: run },
            busy ? "Recalling\u2026" : "Run recall",
          ),
        ),
        error ? h("p", { style: Object.assign({}, S.hint, { color: T.danger }) }, error) : null,
        result
          ? h(
              "div",
              null,
              h("h3", { style: S.sectionTitle }, "Hits (" + result.items.length + ")"),
              result.items.length === 0
                ? h("p", { style: S.hint }, "Nothing matched this query.")
                : h(
                    "div",
                    { style: S.list },
                    result.items.map((item) =>
                      h(
                        "div",
                        {
                          key: item.id,
                          style: S.card,
                          onClick: () => props.onOpen(item.id),
                        },
                        h("div", { style: S.cardTitle }, item.title),
                        h(
                          "div",
                          { style: S.meta },
                          item.kind + " \u00b7 " + item.scope + " \u00b7 " + item.project + " \u00b7 " + item.status,
                        ),
                        h("div", { style: S.pills }, legs(item)),
                      ),
                    ),
                  ),
              h("h3", { style: S.sectionTitle }, "Rendered text (" + result.format + ")"),
              h("pre", { style: S.pre }, result.text),
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
      const [error, setError] = React.useState("");

      React.useEffect(() => {
        let alive = true;
        apiGet(props.base, "/api/status")
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
          h(Kpi, { value: report.total, label: "Total entries" }),
          h(Kpi, { value: report.active, label: "Active" }),
          h(Kpi, { value: report.dbSizeBytes, label: "Index bytes" }),
        ),
        h("div", { style: S.meta }, "root: " + report.root + "\ndatabase: " + report.dbPath),
        h(Bars, { title: "By kind", counts: report.byKind }),
        h(Bars, { title: "By scope", counts: report.byScope }),
        h(Bars, { title: "By status", counts: report.byStatus }),
        h(Bars, { title: "By project", counts: report.byProject }),
        h(VectorPanel, { vectors: report.vectors }),
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
      const [version, setVersion] = React.useState(0);
      const [busy, setBusy] = React.useState(false);
      const [status, setStatus] = React.useState({ text: "", error: false });
      const [healReport, setHealReport] = React.useState(null);
      const { byId: actionById } = useUIActions(props.base);
      const [workspaces, setWorkspaces] = React.useState(null);

      const run = async (text, task) => {
        setBusy(true);
        setStatus({ text, error: false });
        try {
          const message = await task();
          setStatus({ text: message, error: false });
          setVersion((previous) => previous + 1);
        } catch (error) {
          setStatus({ text: errorText(error), error: true });
        } finally {
          setBusy(false);
        }
      };

      const heal = () =>
        run("Healing\u2026", async () => {
          const report = await apiPost(props.base, "/api/heal", {});
          setHealReport(report);
          props.onSaved();
          return "Heal finished.";
        });

      const rebuildVectors = () =>
        run("Rebuilding vectors\u2026", async () => {
          const data = await apiPost(props.base, "/api/vectors/rebuild", {});
          const vectors = data && data.vectors ? data.vectors : null;
          setVersion((value) => value + 1);
          if (!vectors) return "Vectors are off: enable the embeddings provider in Settings.";
          return "Vector rebuild queued: " + vectors.pending + " entries waiting.";
        });

      const repairVectors = () =>
        run("Repairing vectors\u2026", async () => {
          const data = await apiPost(props.base, "/api/vectors/repair", {});
          const report = data && data.vectors ? data.vectors : null;
          setVersion((value) => value + 1);
          if (!report) return "Vectors are off: enable the embeddings provider in Settings.";
          return (
            "Vectors repaired \u2014 leftovers " +
            report.orphansRemoved +
            ", metadata " +
            report.metadataFixed +
            ", damaged " +
            report.badRemoved +
            ", other model " +
            report.foreignRemoved +
            ", queued " +
            report.queued +
            ", temp files " +
            report.tempFilesSwept +
            "."
          );
        });

      const rebuildAnn = () =>
        run("Rebuilding the ANN index\u2026", async () => {
          const data = await apiPost(props.base, "/api/vectors/ann/rebuild", {});
          setVersion((value) => value + 1);
          return data && data.rebuilt
            ? "ANN table rebuilt from memory_vectors."
            : "Nothing to rebuild: the " +
                ((data && data.backend) || "in-process") +
                " backend reads memory_vectors directly.";
        });

      const syncWorkspaces = () =>
        run("Syncing workspaces\u2026", async () => {
          const data = await apiPost(props.base, "/api/workspaces/sync", {});
          setWorkspaces({ workspaces: data.workspaces, projects: data.projects });
          const summary = data.workspaces;
          if (!summary) return "Workspaces: no data.";
          if (summary.unavailable) return "Workspaces: registry unavailable.";
          return (
            "Workspaces: created " +
            summary.created.length +
            ", existing " +
            summary.existing.length +
            ", skipped " +
            summary.skipped.length +
            ", errors " +
            summary.errors.length +
            "."
          );
        });

      const listBlock = (title, items) =>
        h("div", { key: title }, [
          h("h4", { key: "t", style: S.sectionTitle }, title + " (" + items.length + ")"),
          items.length
            ? h(
                "ul",
                { key: "l", style: S.list },
                items.map((item, index) => h("li", { key: index }, item)),
              )
            : h("p", { key: "e", style: S.hint }, "none"),
        ]);

      return h(
        "div",
        null,
        h(
          "div",
          { style: S.panel },
          h(
            "div",
            { style: S.row },
            actionById["lint.run"] ? h("button", { type: "button", style: S.primary, disabled: busy, onClick: () => setVersion((v) => v + 1) }, actionById["lint.run"].label) : null,
            actionById["heal.apply"] ? h("button", { type: "button", style: S.button, disabled: busy, onClick: heal }, actionById["heal.apply"].label) : null,
            actionById["vectors.rebuild"] ? h("button", { type: "button", style: S.button, disabled: busy, onClick: rebuildVectors }, actionById["vectors.rebuild"].label) : null,
            h("button", { type: "button", style: S.button, disabled: busy, onClick: repairVectors }, "Repair vectors"),
            h("button", { type: "button", style: S.button, disabled: busy, onClick: rebuildAnn }, "Rebuild ANN index"),
            h("button", { type: "button", style: S.button, disabled: busy, onClick: syncWorkspaces }, "Sync workspaces"),
            h(
              "button",
              { type: "button", style: S.button, disabled: busy, onClick: () => setVersion((v) => v + 1) },
              "Refresh status / health",
            ),
            h(Notice, { text: status.text, error: status.error }),
          ),
        ),
        h("div", { style: S.panel }, h(StatusPanel, { base: props.base, version })),
        h("div", { style: S.panel }, h(LintPanel, { base: props.base, version })),
        healReport
          ? h(
              "div",
              { style: S.panel },
              h("h3", { style: S.sectionTitle }, "Heal report"),
              h(
                "pre",
                { style: S.pre },
                "Removed broken links: " +
                  healReport.removedLinks +
                  "\nAdded backlinks: " +
                  healReport.addedBacklinks +
                  "\nReindexed entries: " +
                  healReport.reindexed +
                  "\nBroken links: " +
                  healReport.brokenBefore +
                  " -> " +
                  healReport.brokenAfter +
                  (healReport.vectors
                    ? "\nVectors checked: " +
                      healReport.vectors.checked +
                      "\n  leftovers removed: " +
                      healReport.vectors.orphansRemoved +
                      "\n  metadata refreshed: " +
                      healReport.vectors.metadataFixed +
                      "\n  damaged removed: " +
                      healReport.vectors.badRemoved +
                      "\n  other model removed: " +
                      healReport.vectors.foreignRemoved +
                      "\n  queued for embedding: " +
                      healReport.vectors.queued +
                      "\n  temp files swept: " +
                      healReport.vectors.tempFilesSwept
                    : ""),
              ),
            )
          : null,
        workspaces
          ? h(
              "div",
              { style: S.panel },
              h("h3", { style: S.sectionTitle }, "Workspace sync report"),
              workspaces.workspaces && workspaces.workspaces.unavailable
                ? h("p", { style: S.hint }, "Workspace registry is unavailable in this profile.")
                : h("div", null, [
                    h("p", { key: "p", style: S.hint }, "Projects seen: " + (workspaces.projects || []).length),
                    listBlock("Created", (workspaces.workspaces || {}).created || []),
                    listBlock("Already registered", (workspaces.workspaces || {}).existing || []),
                    listBlock("Skipped", (workspaces.workspaces || {}).skipped || []),
                    listBlock("Errors", (workspaces.workspaces || {}).errors || []),
                  ]),
            )
          : null,
      );
    }

    /* ------------------------------------------------------------------ *
     * overlay
     * ------------------------------------------------------------------ */

    function Overlay(props) {
      const overlay = props.overlay;
      if (!overlay) return null;

      const close = props.onClose;
      const body = [];

      if (overlay.kind === "item") {
        const entry = overlay.entry;
        body.push(h("h2", { key: "t", style: S.overlayTitle }, entry.title || "(untitled)"));
        body.push(
          h(
            "div",
            { key: "m", style: S.meta },
            entry.id +
              " \u00b7 " +
              entry.scope +
              (entry.project ? "/" + entry.project : "") +
              " \u00b7 " +
              entry.kind +
              " \u00b7 " +
              entry.status +
              " \u00b7 " +
              entry.tier,
          ),
        );
        body.push(
          h(
            "div",
            { key: "p", style: S.pills },
            (entry.tags || []).map((tag) => h(Pill, { key: tag }, tag)),
          ),
        );
        body.push(h("div", { key: "x", style: Object.assign({}, S.text, { maxHeight: "none" }) }, entry.text));
        body.push(
          h(
            "div",
            { key: "a", style: S.actions },
            h("button", { type: "button", style: S.button, onClick: () => props.onEdit(entry) }, "Edit"),
            h("button", { type: "button", style: S.button, onClick: () => props.onForget(entry.id) }, "Forget"),
            h("button", { type: "button", style: S.danger, onClick: () => props.onDelete(entry.id) }, "Delete"),
            h("button", { type: "button", style: S.button, onClick: close }, "Close"),
          ),
        );
      } else if (overlay.kind === "confirm") {
        body.push(h("h2", { key: "t", style: S.overlayTitle }, overlay.title));
        body.push(h("p", { key: "m", style: Object.assign({}, S.hint, { fontSize: "12px" }) }, overlay.message));
        body.push(
          h(
            "div",
            { key: "a", style: S.actions },
            h(
              "button",
              {
                type: "button",
                style: overlay.danger ? S.danger : S.primary,
                onClick: overlay.onConfirm,
              },
              overlay.confirmLabel,
            ),
            h("button", { type: "button", style: S.button, onClick: close }, "Cancel"),
          ),
        );
      } else {
        body.push(h("h2", { key: "t", style: S.overlayTitle }, overlay.title));
        body.push(h("pre", { key: "b", style: S.pre }, overlay.text));
        body.push(
          h(
            "div",
            { key: "a", style: S.actions },
            h("button", { type: "button", style: S.button, onClick: close }, "Close"),
          ),
        );
      }

      return h(
        "div",
        {
          style: S.overlay,
          role: "dialog",
          "aria-label": overlay.title || VIEW_LABEL,
          onClick: (event) => {
            if (event.target === event.currentTarget) close();
          },
        },
        h("div", { style: S.overlayBox }, body),
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

        const importMemory = async () => {
          setBusy(true);
          setActionStatus({ text: "Importing\u2026", error: false });
          try {
            const data = await apiPost(base, "/api/import", {});
            const lines = [
              "Imported " +
                data.totals.imported +
                ", updated " +
                data.totals.updated +
                ", skipped " +
                data.totals.skipped +
                ".",
            ];
            if (data.totals.droppedRelations) {
              lines.push("Dropped unresolved relation links: " + data.totals.droppedRelations + ".");
            }
            (data.reports || []).forEach((report) => {
              lines.push(
                "- " +
                  report.source +
                  ": imported=" +
                  report.imported +
                  " updated=" +
                  report.updated +
                  " skipped=" +
                  report.skipped +
                  (report.droppedRelations ? " dropped=" + report.droppedRelations : "") +
                  (report.errors && report.errors.length ? " errors=" + report.errors.length : ""),
              );
            });
            setOverlay({ kind: "report", title: "Import report", text: lines.join("\n") });
            setActionStatus({ text: "Import finished.", error: false });
            await refreshProjects();
            refreshBrowse();
          } catch (error) {
            setActionStatus({ text: errorText(error), error: true });
          } finally {
            setBusy(false);
          }
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
          content = h("div", { style: S.panel }, h(StatusPanel, { base, version: browseVersion }));
        } else if (tab === "items") {
          content = h(BrowseTab, { base, version: browseVersion, projects, handlers, pagination: itemsPagination });
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
          { style: S.root },
          h(
            "div",
            { style: S.toolbar },
            (panelActions.find((action) => action.id === "import.run") || null)
              ? h("button", { type: "button", style: S.button, disabled: busy, onClick: importMemory }, panelActions.find((action) => action.id === "import.run").label)
              : null,
            h("span", { style: S.toolbarSpacer }),
            h(Notice, { text: actionStatus.text, error: actionStatus.error }),
            h(
              "button",
              { type: "button", style: S.button, disabled: busy, onClick: refreshBrowse },
              "Refresh",
            ),
          ),
          h(
            "nav",
            { style: S.tabs, role: "tablist" },
            views.map((view) =>
              h(
                "button",
                {
                  key: view.id,
                  type: "button",
                  role: "tab",
                  "aria-selected": tab === view.id ? "true" : "false",
                  style: tab === view.id ? S.tabActive : S.tab,
                  onClick: () => setTab(view.id),
                },
                view.title,
              ),
            ),
          ),
          h("div", { style: S.content }, content),
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
              "importRoots",
              String(form.importRoots || "")
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0),
            );
            await scope.set("importAutoDetect", !!form.importAutoDetect);
            await scope.set(
              "rulesSource",
              form.rulesSource === "kilo-verbatim" ? "kilo-verbatim" : "bundled-en",
            );
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

        const importMemory = async () => {
          setBusy(true);
          setReport("Importing\u2026");
          try {
            const data = await apiPost(webBase(scope), "/api/import", {});
            const lines = [
              "Imported " + data.totals.imported + ", updated " + data.totals.updated + ", skipped " + data.totals.skipped + ".",
            ];
            if (data.totals.droppedRelations) {
              lines.push("Dropped unresolved relation links: " + data.totals.droppedRelations + ".");
            }
            (data.reports || []).forEach((item) => {
              lines.push(
                "- " +
                  item.source +
                  ": imported=" +
                  item.imported +
                  " updated=" +
                  item.updated +
                  " skipped=" +
                  item.skipped +
                  (item.droppedRelations ? " dropped=" + item.droppedRelations : "") +
                  (item.errors && item.errors.length ? " errors=" + item.errors.length : ""),
              );
            });
            setReport(lines.join("\n"));
          } catch (error) {
            setReport("Import failed: " + errorText(error));
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
            (panelActions.find((action) => action.id === "import.run") || null)
              ? h("button", { type: "button", style: S.button, disabled: busy, onClick: importMemory }, panelActions.find((action) => action.id === "import.run").label)
              : null,
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
