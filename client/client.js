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
    const ALREADY_EXPORTED_NOTE = "Rules are already exported to ~/.dsh/AGENTS.md.";
    const PREVIEW_TEXT_LIMIT = 20000;
    const GRAPH_HEIGHT = 520;

    const inject = ["slots", "configForms"];

    const KINDS = ["rules", "preferences", "decisions", "facts", "architecture", "concepts"];
    const TABS = [
      ["browse", "Search & Browse"],
      ["edit", "Create / Edit"],
      ["graph", "Graph"],
      ["status", "Status"],
      ["lint", "Lint"],
      ["health", "Health"],
    ];

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

    function Field(props) {
      return h(
        "div",
        { style: S.field },
        h("span", { style: S.label }, props.label),
        props.children,
        props.hint ? h("small", { style: S.hint }, props.hint) : null,
      );
    }

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
      const [limit, setLimit] = React.useState("50");
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
        if (limit) params.set("limit", limit);
        setError("");
        try {
          const data = await apiGet(props.base, "/api/items?" + params.toString());
          setItems(data.items || []);
          setTotal(data.total || 0);
        } catch (err) {
          setItems(null);
          setError(errorText(err));
        }
      }, [props.base, query, kind, scope, status, project, limit]);

      React.useEffect(() => {
        load();
      }, [props.version]);

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
              { label: "Limit" },
              h("input", {
                type: "number",
                min: 1,
                max: 500,
                style: Object.assign({}, S.input, { width: "80px", minWidth: "80px" }),
                value: limit,
                onChange: (event) => setLimit(event.target.value),
              }),
            ),
            h("button", { type: "button", style: S.primary, onClick: load }, "Search"),
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
     * conversation.view — Status and Lint
     * ------------------------------------------------------------------ */

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
            h("button", { type: "button", style: S.primary, disabled: busy, onClick: () => setVersion((v) => v + 1) }, "Run lint"),
            h("button", { type: "button", style: S.button, disabled: busy, onClick: heal }, "Heal"),
            h("button", { type: "button", style: S.button, disabled: busy, onClick: props.onPreviewRules }, "Preview rules"),
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
                  healReport.brokenAfter,
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
      } else if (overlay.kind === "rules") {
        const data = overlay.data || {};
        body.push(h("h2", { key: "t", style: S.overlayTitle }, "Rules export preview"));
        body.push(
          h(
            "p",
            { key: "m", style: S.hint },
            "Target: " + data.target + " \u00b7 Mode: " + data.mode + (data.changed ? "" : " \u00b7 no changes"),
          ),
        );
        if (data.message) body.push(h("p", { key: "msg", style: S.hint }, data.message));
        if (data.alreadyExported) body.push(h("p", { key: "al", style: S.hint }, ALREADY_EXPORTED_NOTE));
        body.push(h("h3", { key: "sh", style: S.sectionTitle }, "Sources"));
        body.push(
          h(
            "pre",
            { key: "s", style: S.pre },
            (data.sources || []).map((source) => "- " + source.path + " (" + source.bytes + " bytes)").join("\n") ||
              "none",
          ),
        );
        body.push(h("h3", { key: "bh", style: S.sectionTitle }, "Block"));
        body.push(h("pre", { key: "b", style: S.pre }, truncatePreview(data.block)));
        body.push(
          h(
            "div",
            { key: "a", style: S.actions },
            h(
              "button",
              {
                type: "button",
                style: data.alreadyExported ? Object.assign({}, S.primary, S.disabled) : S.primary,
                disabled: !!data.alreadyExported || props.busy,
                onClick: props.onExportRules,
              },
              "Confirm export",
            ),
            h("button", { type: "button", style: S.button, onClick: close }, "Cancel"),
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
        const [tab, setTab] = React.useState("browse");
        const [overlay, setOverlay] = React.useState(null);
        const [editDraft, setEditDraft] = React.useState(null);
        const [editKey, setEditKey] = React.useState(0);
        const [browseVersion, setBrowseVersion] = React.useState(0);
        const [projects, setProjects] = React.useState([]);
        const [actionStatus, setActionStatus] = React.useState({ text: "", error: false });
        const [busy, setBusy] = React.useState(false);
        const [alreadyExported, setAlreadyExported] = React.useState(false);

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

        const refreshRulesExportState = React.useCallback(async () => {
          try {
            const data = await apiPost(base, "/api/rules/preview", {});
            setAlreadyExported(data && data.alreadyExported === true);
          } catch (error) {
            setAlreadyExported(false);
          }
        }, [base]);

        React.useEffect(() => {
          refreshProjects();
          refreshRulesExportState();
        }, [refreshProjects, refreshRulesExportState]);

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

        const previewRules = async () => {
          setBusy(true);
          setActionStatus({ text: "Loading rules preview\u2026", error: false });
          try {
            const data = await apiPost(base, "/api/rules/preview", {});
            setAlreadyExported(data && data.alreadyExported === true);
            setOverlay({ kind: "rules", data });
            setActionStatus({ text: "Preview ready. Review before exporting.", error: false });
          } catch (error) {
            setActionStatus({ text: errorText(error), error: true });
          } finally {
            setBusy(false);
          }
        };

        const exportRules = async () => {
          setOverlay(null);
          setBusy(true);
          setActionStatus({ text: "Exporting rules\u2026", error: false });
          try {
            const data = await apiPost(base, "/api/rules/export", {});
            const lines = [data.message || "changed=" + data.changed + ", bytes=" + data.bytes];
            lines.push("target: " + data.target);
            (data.sources || []).forEach((source) => lines.push("- " + source));
            setOverlay({ kind: "report", title: "Rules export report", text: lines.join("\n") });
            setActionStatus({ text: data.changed ? "Rules exported." : "Nothing to export.", error: false });
            await refreshRulesExportState();
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

        let content = null;
        if (tab === "browse") {
          content = h(BrowseTab, {
            base,
            version: browseVersion,
            projects,
            handlers,
          });
        } else if (tab === "edit") {
          content = h(EditTab, {
            key: editKey,
            base,
            draft: editDraft,
            onSaved: refreshBrowse,
          });
        } else if (tab === "graph") {
          content = h(GraphTab, { base, onOpen: openItem });
        } else if (tab === "status") {
          content = h("div", { style: S.panel }, h(StatusPanel, { base, version: browseVersion }));
        } else if (tab === "lint") {
          content = h("div", { style: S.panel }, h(LintPanel, { base, version: browseVersion }));
        } else {
          content = h(HealthTab, { base, onPreviewRules: previewRules, onSaved: refreshBrowse });
        }

        return h(
          "div",
          { style: S.root },
          h(
            "div",
            { style: S.toolbar },
            h("button", { type: "button", style: S.button, disabled: busy, onClick: importMemory }, "Import memory"),
            h(
              "button",
              {
                type: "button",
                style: alreadyExported ? Object.assign({}, S.button, S.disabled) : S.button,
                disabled: busy || alreadyExported,
                title: alreadyExported ? ALREADY_EXPORTED_NOTE : undefined,
                onClick: previewRules,
              },
              "Export rules to dsh AGENTS.md",
            ),
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
            TABS.map(([id, label]) =>
              h(
                "button",
                {
                  key: id,
                  type: "button",
                  role: "tab",
                  "aria-selected": tab === id ? "true" : "false",
                  style: tab === id ? S.tabActive : S.tab,
                  onClick: () => setTab(id),
                },
                label,
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
            onExportRules: exportRules,
          }),
        );
      };
    }

    /* ------------------------------------------------------------------ *
     * settings.section — dedicated entry in the Settings left menu
     * ------------------------------------------------------------------ */

    function createSettingsCard(scope) {
      return function SettingsCard() {
        const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot());
        const [form, setForm] = React.useState(() => toForm(snapshot.value));
        const [notice, setNotice] = React.useState("");
        const [report, setReport] = React.useState("");
        const [busy, setBusy] = React.useState(false);
        const [preview, setPreview] = React.useState(null);
        const [alreadyExported, setAlreadyExported] = React.useState(false);

        const refreshRulesExportState = async () => {
          try {
            const data = await apiPost(webBase(scope), "/api/rules/preview", {});
            setAlreadyExported(!!(data && data.alreadyExported === true));
          } catch (error) {
            setAlreadyExported(false);
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
          refreshRulesExportState();
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

        const loadRulesPreview = async () => {
          setBusy(true);
          setReport("");
          try {
            const data = await apiPost(webBase(scope), "/api/rules/preview", {});
            setPreview(data);
            setAlreadyExported(!!(data && data.alreadyExported === true));
          } catch (error) {
            setPreview(null);
            setReport("Preview failed: " + errorText(error));
          } finally {
            setBusy(false);
          }
        };

        const confirmRulesExport = async () => {
          setBusy(true);
          setReport("Exporting rules\u2026");
          try {
            const data = await apiPost(webBase(scope), "/api/rules/export", {});
            const lines = [data.message || "changed=" + data.changed + ", bytes=" + data.bytes, "target: " + data.target];
            (data.sources || []).forEach((source) => lines.push("- " + source));
            setReport(lines.join("\n"));
            setPreview(null);
            setAlreadyExported(!!(data && data.alreadyExported === true));
            await refreshRulesExportState();
          } catch (error) {
            setReport("Export failed: " + errorText(error));
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
          h(
            Field,
            { label: "Storage root", hint: "Memory root directory. Empty uses $DSH_HOME/llm-memory." },
            h("input", inputProps("storageRoot")),
          ),
          h(
            Field,
            { label: "Recall limit", hint: "Maximum number of entries returned by llm_memory_recall." },
            h("input", {
              type: "number",
              min: 1,
              max: 1000,
              style: S.input,
              value: form.recallLimit,
              onChange: (event) => update("recallLimit", event.target.value),
            }),
          ),
          h(
            "label",
            { style: S.checkboxRow },
            h("input", {
              type: "checkbox",
              checked: !!form.autonomous,
              onChange: (event) => update("autonomous", event.target.checked),
            }),
            "Autonomous memory management (no user confirmation)",
          ),
          h(
            "label",
            { style: S.checkboxRow },
            h("input", {
              type: "checkbox",
              checked: !!form.requireConfirmation,
              onChange: (event) => update("requireConfirmation", event.target.checked),
            }),
            "Require confirmation for irreversible operations",
          ),
          h(
            Field,
            {
              label: "System prompt guidance",
              hint: "Injected into the agent context. English by default; edit to override.",
            },
            h("textarea", {
              style: Object.assign({}, S.input, { minHeight: "96px", width: "100%", resize: "vertical" }),
              value: form.systemPrompt,
              onChange: (event) => update("systemPrompt", event.target.value),
            }),
          ),
          h(
            Field,
            { label: "Import roots", hint: "Extra directories to scan for foreign memory, one path per line." },
            h("textarea", {
              style: Object.assign({}, S.input, { minHeight: "96px", width: "100%", resize: "vertical" }),
              value: form.importRoots,
              onChange: (event) => update("importRoots", event.target.value),
            }),
          ),
          h(
            "label",
            { style: S.checkboxRow },
            h("input", {
              type: "checkbox",
              checked: !!form.importAutoDetect,
              onChange: (event) => update("importAutoDetect", event.target.checked),
            }),
            "Auto-detect Kilo / mnemon / dsh-memory roots",
          ),
          h(
            Field,
            {
              label: "Rules export source",
              hint: "Bundled English translation reads the rules shipped with the plugin; Verbatim Kilo files reads the original Kilo config files.",
            },
            h(
              "select",
              {
                style: S.input,
                value: form.rulesSource,
                onChange: (event) => update("rulesSource", event.target.value),
              },
              h("option", { style: S.option, value: "bundled-en" }, "Bundled English translation"),
              h("option", { style: S.option, value: "kilo-verbatim" }, "Verbatim Kilo files"),
            ),
          ),
          h(
            Field,
            {
              label: "Lint overlap minimum common words",
              hint: "Minimum shared significant words before two memories are reported as overlapping.",
            },
            h("input", {
              type: "number",
              min: 1,
              max: 1000,
              style: S.input,
              value: form.lintOverlapMinCommonWords,
              onChange: (event) => update("lintOverlapMinCommonWords", event.target.value),
            }),
          ),
          h(
            Field,
            { label: "Lint maximum pairs", hint: "Maximum number of overlap pairs checked (0 means unlimited)." },
            h("input", {
              type: "number",
              min: 0,
              max: 100000,
              style: S.input,
              value: form.lintMaxPairs,
              onChange: (event) => update("lintMaxPairs", event.target.value),
            }),
          ),
          h(
            Field,
            { label: "WebUI base path", hint: "Base HTTP path of the WebUI and API. Takes effect after the plugin restarts." },
            h("input", inputProps("webPath")),
          ),
          h(
            "div",
            { style: S.actions },
            h("button", { type: "button", style: S.primary, disabled: busy, onClick: save }, "Save settings"),
            h("button", { type: "button", style: S.button, disabled: busy, onClick: importMemory }, "Import memory"),
            h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-start" } },
              h(
                "button",
                {
                  type: "button",
                  style: alreadyExported ? Object.assign({}, S.button, S.disabled) : S.button,
                  disabled: busy || alreadyExported,
                  title: alreadyExported ? ALREADY_EXPORTED_NOTE : undefined,
                  onClick: loadRulesPreview,
                },
                "Export rules to dsh AGENTS.md",
              ),
              alreadyExported ? h("small", { style: S.hint }, ALREADY_EXPORTED_NOTE) : null,
            ),
          ),
          preview
            ? h(
                "div",
                { style: S.panel },
                h("h3", { key: "title", style: S.sectionTitle }, "Rules export preview"),
                h(
                  "p",
                  { key: "meta", style: S.hint },
                  "Target: " +
                    preview.target +
                    " \u00b7 Mode: " +
                    preview.mode +
                    (preview.changed ? "" : " \u00b7 no changes"),
                ),
                preview.message ? h("p", { key: "message", style: S.hint }, preview.message) : null,
                h(
                  "p",
                  { key: "sources", style: S.hint },
                  (preview.sources || []).length === 0
                    ? "Sources: none"
                    : "Sources: " +
                        (preview.sources || []).map((source) => source.path + " (" + source.bytes + " bytes)").join("; "),
                ),
                preview.alreadyExported ? h("p", { key: "already", style: S.hint }, ALREADY_EXPORTED_NOTE) : null,
                h("pre", { key: "block", style: S.pre }, truncatePreview(preview.block)),
                h(
                  "div",
                  { key: "actions", style: S.actions },
                  h(
                    "button",
                    {
                      type: "button",
                      style: preview.alreadyExported ? Object.assign({}, S.primary, S.disabled) : S.primary,
                      disabled: busy || !!preview.alreadyExported,
                      title: preview.alreadyExported ? ALREADY_EXPORTED_NOTE : undefined,
                      onClick: confirmRulesExport,
                    },
                    "Confirm export",
                  ),
                  h(
                    "button",
                    { type: "button", style: S.button, disabled: busy, onClick: () => setPreview(null) },
                    "Cancel",
                  ),
                ),
              )
            : null,
          notice ? h("p", { style: S.status }, notice) : null,
          report ? h("pre", { style: S.pre }, report) : null,
        );
      };
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
