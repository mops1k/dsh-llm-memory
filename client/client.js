/**
 * dsh-llm-memory client half (classic browser module).
 *
 * Registered through the dsh module loader: a conversation View that embeds the
 * host WebUI in an iframe, a sidebar footer action that opens that View, and the
 * settings card for the plugin namespace. All UI text is English.
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

    const inject = ["slots", "settingsScope"];

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

    function intValue(value, fallback, min, max) {
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      const rounded = Math.round(parsed);
      if (rounded < min) return min;
      if (rounded > max) return max;
      return rounded;
    }

    const PREVIEW_TEXT_LIMIT = 20000;

    function truncatePreview(value) {
      const text = String(value == null ? "" : value);
      if (text.length <= PREVIEW_TEXT_LIMIT) return text;
      return text.slice(0, PREVIEW_TEXT_LIMIT) + "\n\u2026 truncated, " + text.length + " chars total";
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

    function normalizeTabText(value) {
      return String(value == null ? "" : value)
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    }

    function findMemoryViewTab() {
      if (typeof document === "undefined") return null;
      const wanted = [normalizeTabText(VIEW_LABEL), normalizeTabText(VIEW_ID)];
      const groups = [
        document.querySelectorAll('[role="tablist"] [role="tab"]'),
        document.querySelectorAll('[role="tab"]'),
      ];
      for (let g = 0; g < groups.length; g += 1) {
        const tabs = groups[g];
        for (let i = 0; i < tabs.length; i += 1) {
          if (wanted.indexOf(normalizeTabText(tabs[i].textContent)) >= 0) return tabs[i];
        }
      }
      return null;
    }

    function openMemoryViewTab() {
      const existing = findMemoryViewTab();
      if (existing) {
        existing.click();
        return true;
      }
      // Tabs render asynchronously, so retry briefly (~2s) before giving up.
      let attempts = 0;
      const maxAttempts = 20;
      const timer = window.setInterval(() => {
        attempts += 1;
        const tab = findMemoryViewTab();
        if (tab) {
          window.clearInterval(timer);
          tab.click();
          return;
        }
        if (attempts >= maxAttempts) {
          window.clearInterval(timer);
          if (typeof console !== "undefined" && typeof console.debug === "function") {
            console.debug("[dsh-llm-memory] memory view tab was not found; nothing opened.");
          }
        }
      }, 100);
      return true;
    }

    const PANEL_ID = "dsh-llm-memory-panel";

    function panelUrl(scope) {
      return joinUrl(webBase(scope), "/ui");
    }

    function buildPanel(scope) {
      const panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", VIEW_LABEL);
      panel.style.cssText = [
        "position:fixed",
        "top:0",
        "right:0",
        "bottom:0",
        "left:264px",
        "z-index:2147483000",
        "display:flex",
        "flex-direction:column",
        "background:var(--vscode-editor-background,#1e1e1e)",
        "color:inherit",
        "border-left:1px solid rgba(127,127,127,0.35)",
        "box-shadow:-8px 0 24px rgba(0,0,0,0.28)",
        "pointer-events:auto",
        "font:inherit",
      ].join(";");

      const header = document.createElement("div");
      header.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(127,127,127,0.35);flex:0 0 auto";

      const title = document.createElement("span");
      title.textContent = VIEW_LABEL;
      title.style.cssText = "font-size:13px;font-weight:500";

      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Close";
      close.style.cssText =
        "padding:6px 12px;border-radius:8px;border:1px solid rgba(127,127,127,0.35);background:transparent;color:inherit;cursor:pointer;font:inherit";
      close.addEventListener("click", () => {
        hidePanel();
      });

      header.appendChild(title);
      header.appendChild(close);

      const frame = document.createElement("iframe");
      frame.title = VIEW_LABEL;
      frame.src = panelUrl(scope);
      frame.style.cssText =
        "flex:1 1 auto;width:100%;height:100%;border:0;display:block;background:transparent";

      panel.appendChild(header);
      panel.appendChild(frame);
      return panel;
    }

    /** Hide the panel and drop the global listeners it installed. */
    function hidePanel() {
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.style.display = "none";
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
    }

    /** Close on any pointer press outside the panel (sidebar button excluded). */
    function onDocumentPointerDown(event) {
      const panel = document.getElementById(PANEL_ID);
      if (!panel || panel.style.display === "none") return;
      const target = event.target;
      if (target && typeof target.nodeType === "number" && panel.contains(target)) return;
      if (
        target &&
        typeof target.closest === "function" &&
        target.closest("[data-llm-memory-toggle]")
      ) {
        return;
      }
      hidePanel();
    }

    /** Close on Escape. */
    function onDocumentKeyDown(event) {
      if (event.key === "Escape") hidePanel();
    }

    /** Install the outside-click / Escape listeners (idempotent). */
    function showPanelListeners() {
      document.addEventListener("pointerdown", onDocumentPointerDown, true);
      document.addEventListener("keydown", onDocumentKeyDown, true);
    }

    /**
     * Mount or toggle the WebUI panel directly in the DOM. This path only
     * depends on the sidebar button, not on undeclared slots or View tabs.
     */
    function togglePanel(scope) {
      if (typeof document === "undefined" || !document.body) return false;
      let panel = document.getElementById(PANEL_ID);
      if (!panel) {
        panel = buildPanel(scope);
        document.body.appendChild(panel);
        showPanelListeners();
        if (typeof console !== "undefined" && typeof console.debug === "function") {
          console.debug("[dsh-llm-memory] panel mounted");
        }
        return true;
      }
      const hidden = panel.style.display === "none";
      panel.style.display = hidden ? "flex" : "none";
      if (hidden) {
        const frame = panel.querySelector("iframe");
        if (frame) frame.src = panelUrl(scope);
        showPanelListeners();
      } else {
        hidePanel();
      }
      return true;
    }

    async function postJson(scope, path, body) {
      const response = await fetch(joinUrl(webBase(scope), path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        data = null;
      }
      if (!response.ok) {
        throw new Error(data && data.error ? data.error : `HTTP ${response.status}`);
      }
      return data;
    }

    /* ------------------------------------------------------------------ *
     * conversation.view — the WebUI iframe
     * ------------------------------------------------------------------ */

    function createMemoryView(scope) {
      return function MemoryView() {
        const [base, setBase] = React.useState(() => webBase(scope));
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
        return h("iframe", {
          src: joinUrl(base, "/ui"),
          title: VIEW_LABEL,
          style: {
            width: "100%",
            height: "100%",
            minHeight: "480px",
            border: "0",
            display: "block",
            background: "transparent",
          },
        });
      };
    }

    /* ------------------------------------------------------------------ *
     * shell.overlay — panel that hosts the WebUI iframe
     *
     * The shell has no public API to switch `conversation.view` tabs and the
     * tab element is not always rendered, so the primary opening path is this
     * overlay: the sidebar button emits a window event, the overlay listens.
     * ------------------------------------------------------------------ */

    const OVERLAY = {
      panel: {
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        left: "264px",
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        background: "var(--vscode-editor-background, #1e1e1e)",
        color: "inherit",
        pointerEvents: "auto",
        borderLeft: "1px solid rgba(127,127,127,0.35)",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.28)",
      },
      header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "8px 12px",
        borderBottom: "1px solid rgba(127,127,127,0.35)",
        flex: "0 0 auto",
        font: "inherit",
      },
      title: { fontSize: "13px", fontWeight: 500 },
      close: {
        padding: "6px 12px",
        borderRadius: "8px",
        border: "1px solid rgba(127,127,127,0.35)",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        font: "inherit",
      },
      frame: {
        flex: "1 1 auto",
        width: "100%",
        height: "100%",
        border: "0",
        display: "block",
        background: "transparent",
      },
    };

    function createOverlay(scope) {
      return function Overlay() {
        const [open, setOpen] = React.useState(false);
        const [base, setBase] = React.useState(() => webBase(scope));

        React.useEffect(() => {
          if (typeof console !== "undefined" && typeof console.debug === "function") {
            console.debug("[dsh-llm-memory] overlay mounted");
          }
          // The listener is permanent: repeated opens keep working even if the
          // first event fired before this component mounted.
          const onOpen = () => setOpen(true);
          window.addEventListener("dsh-llm-memory:open", onOpen);
          return () => window.removeEventListener("dsh-llm-memory:open", onOpen);
        }, []);

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

        if (!open) return null;

        return h(
          "div",
          { style: OVERLAY.panel, role: "dialog", "aria-label": VIEW_LABEL },
          h(
            "div",
            { style: OVERLAY.header },
            h("span", { style: OVERLAY.title }, VIEW_LABEL),
            h(
              "button",
              {
                type: "button",
                style: OVERLAY.close,
                title: "Close",
                onClick: () => setOpen(false),
              },
              "Close",
            ),
          ),
          h("iframe", {
            src: joinUrl(base, "/ui"),
            title: VIEW_LABEL,
            style: OVERLAY.frame,
          }),
        );
      };
    }

    /* ------------------------------------------------------------------ *
     * sidebar.footer.action — open the View
     * ------------------------------------------------------------------ */

    function createSidebarAction(scope) {
      return function SidebarAction(props) {
        const wide = !!(props && props.wide);
        const open = () => {
          if (typeof console !== "undefined" && typeof console.debug === "function") {
            console.debug("[dsh-llm-memory] open requested");
          }
          togglePanel(scope);
        };
        return h(
          "button",
          {
            type: "button",
            title: VIEW_LABEL,
            "aria-label": VIEW_LABEL,
            "data-llm-memory-toggle": "true",
            onClick: open,
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: wide ? "flex-start" : "center",
              gap: "8px",
              width: "100%",
              padding: wide ? "6px 10px" : "8px",
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: "8px",
              color: "inherit",
              cursor: "pointer",
              font: "inherit",
              textAlign: "left",
            },
          },
          h(
            "span",
            { "aria-hidden": "true", style: { fontSize: "14px", lineHeight: 1 } },
            "\u25C9",
          ),
          wide ? h("span", null, VIEW_LABEL) : null,
        );
      };
    }

    /* ------------------------------------------------------------------ *
     * settings.section — dedicated entry in the Settings left menu
     * ------------------------------------------------------------------ */

    const S = {
      card: {
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        maxWidth: "720px",
        color: "inherit",
        font: "inherit",
      },
      headerText: { margin: 0, fontSize: "14px", fontWeight: 500 },
      hint: { margin: "4px 0 0", fontSize: "12px", opacity: 0.65, lineHeight: 1.45 },
      field: { display: "flex", flexDirection: "column", gap: "4px" },
      label: { fontSize: "12px", opacity: 0.75 },
      input: {
        padding: "6px 8px",
        borderRadius: "6px",
        border: "1px solid rgba(127,127,127,0.35)",
        background: "transparent",
        color: "inherit",
        font: "inherit",
        width: "100%",
      },
      textarea: {
        padding: "6px 8px",
        borderRadius: "6px",
        border: "1px solid rgba(127,127,127,0.35)",
        background: "transparent",
        color: "inherit",
        font: "inherit",
        width: "100%",
        minHeight: "96px",
        resize: "vertical",
      },
      checkboxRow: { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" },
      actions: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
      button: {
        padding: "6px 12px",
        borderRadius: "8px",
        border: "1px solid rgba(127,127,127,0.35)",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        font: "inherit",
      },
      primary: {
        padding: "6px 12px",
        borderRadius: "8px",
        border: "1px solid rgba(127,127,127,0.35)",
        background: "rgba(76,154,255,0.18)",
        color: "inherit",
        cursor: "pointer",
        font: "inherit",
      },
      disabled: { opacity: 0.5, cursor: "not-allowed" },
      rulesExport: { display: "flex", flexDirection: "column", gap: "2px", alignItems: "flex-start" },
      notice: { fontSize: "12px", opacity: 0.85, whiteSpace: "pre-wrap", margin: 0 },
      report: {
        fontSize: "11px",
        whiteSpace: "pre-wrap",
        margin: 0,
        padding: "8px",
        borderRadius: "6px",
        background: "rgba(127,127,127,0.12)",
        maxHeight: "200px",
        overflow: "auto",
      },
      preview: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "10px",
        borderRadius: "8px",
        border: "1px solid rgba(127,127,127,0.35)",
      },
      previewTitle: { margin: 0, fontSize: "13px", fontWeight: 500 },
      previewPre: {
        margin: 0,
        padding: "8px",
        borderRadius: "6px",
        background: "rgba(127,127,127,0.12)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: "11px",
        whiteSpace: "pre-wrap",
        maxHeight: "320px",
        overflow: "auto",
      },
    };

    function labelled(key, label, hint, control) {
      return h(
        "div",
        { style: S.field, key: key },
        h("span", { style: S.label }, label),
        control,
        hint ? h("small", { style: S.hint }, hint) : null,
      );
    }

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
            const data = await postJson(scope, "/api/rules/preview", {});
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
            setNotice(`Save failed: ${error && error.message ? error.message : String(error)}`);
          } finally {
            setBusy(false);
          }
        };

        const importMemory = async () => {
          setBusy(true);
          setReport("Importing\u2026");
          try {
            const data = await postJson(scope, "/api/import", {});
            const lines = [
              `Imported ${data.totals.imported}, updated ${data.totals.updated}, skipped ${data.totals.skipped}.`,
            ];
            if (data.totals.droppedRelations) {
              lines.push(`Dropped unresolved relation links: ${data.totals.droppedRelations}.`);
            }
            (data.reports || []).forEach((item) => {
              lines.push(
                `- ${item.source}: imported=${item.imported} updated=${item.updated} skipped=${item.skipped}` +
                  (item.droppedRelations ? ` dropped=${item.droppedRelations}` : "") +
                  (item.errors && item.errors.length ? ` errors=${item.errors.length}` : ""),
              );
            });
            setReport(lines.join("\n"));
          } catch (error) {
            setReport(`Import failed: ${error && error.message ? error.message : String(error)}`);
          } finally {
            setBusy(false);
          }
        };

        const loadRulesPreview = async () => {
          setBusy(true);
          setReport("");
          try {
            const data = await postJson(scope, "/api/rules/preview", {});
            setPreview(data);
            setAlreadyExported(!!(data && data.alreadyExported === true));
          } catch (error) {
            setPreview(null);
            setReport(`Preview failed: ${error && error.message ? error.message : String(error)}`);
          } finally {
            setBusy(false);
          }
        };

        const confirmRulesExport = async () => {
          setBusy(true);
          setReport("Exporting rules\u2026");
          try {
            const data = await postJson(scope, "/api/rules/export", {});
            const lines = [data.message || `changed=${data.changed}, bytes=${data.bytes}`, `target: ${data.target}`];
            (data.sources || []).forEach((source) => lines.push(`- ${source}`));
            setReport(lines.join("\n"));
            setPreview(null);
            setAlreadyExported(!!(data && data.alreadyExported === true));
            await refreshRulesExportState();
          } catch (error) {
            setReport(`Export failed: ${error && error.message ? error.message : String(error)}`);
          } finally {
            setBusy(false);
          }
        };

        const cancelRulesPreview = () => setPreview(null);

        const status = snapshot.status;
        const statusNote =
          status === "ready"
            ? null
            : status === "loading"
              ? "Loading current settings\u2026"
              : "The dsh settings service is unavailable; changes cannot be saved in this client.";

        return h(
          "div",
          { style: S.card },
          h("div", null, [
            h("h2", { key: "title", style: S.headerText }, "LLM Memory"),
            h(
              "p",
              { key: "hint", style: S.hint },
              "Layered long-term memory: storage, recall, autonomy and import roots. The system prompt is injected into the agent on every turn.",
            ),
            statusNote ? h("p", { key: "status", style: S.hint }, statusNote) : null,
          ]),
          labelled(
            "storageRoot",
            "Storage root",
            "Memory root directory. Empty uses $DSH_HOME/llm-memory.",
            h("input", {
              type: "text",
              style: S.input,
              value: form.storageRoot,
              onChange: (event) => update("storageRoot", event.target.value),
            }),
          ),
          labelled(
            "recallLimit",
            "Recall limit",
            "Maximum number of entries returned by llm_memory_recall.",
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
          labelled(
            "systemPrompt",
            "System prompt guidance",
            "Injected into the agent context. English by default; edit to override.",
            h("textarea", {
              style: S.textarea,
              value: form.systemPrompt,
              onChange: (event) => update("systemPrompt", event.target.value),
            }),
          ),
          labelled(
            "importRoots",
            "Import roots",
            "Extra directories to scan for foreign memory, one path per line.",
            h("textarea", {
              style: S.textarea,
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
          labelled(
            "rulesSource",
            "Rules export source",
            "Bundled English translation reads the rules shipped with the plugin; Verbatim Kilo files reads the original Kilo config files.",
            h(
              "select",
              {
                style: S.input,
                value: form.rulesSource,
                onChange: (event) => update("rulesSource", event.target.value),
              },
              h("option", { value: "bundled-en" }, "Bundled English translation"),
              h("option", { value: "kilo-verbatim" }, "Verbatim Kilo files"),
            ),
          ),
          labelled(
            "lintOverlapMinCommonWords",
            "Lint overlap minimum common words",
            "Minimum shared significant words before two memories are reported as overlapping.",
            h("input", {
              type: "number",
              min: 1,
              max: 1000,
              style: S.input,
              value: form.lintOverlapMinCommonWords,
              onChange: (event) => update("lintOverlapMinCommonWords", event.target.value),
            }),
          ),
          labelled(
            "lintMaxPairs",
            "Lint maximum pairs",
            "Maximum number of overlap pairs checked (0 means unlimited).",
            h("input", {
              type: "number",
              min: 0,
              max: 100000,
              style: S.input,
              value: form.lintMaxPairs,
              onChange: (event) => update("lintMaxPairs", event.target.value),
            }),
          ),
          labelled(
            "webPath",
            "WebUI base path",
            "Base HTTP path of the WebUI and API. Takes effect after the plugin restarts.",
            h("input", {
              type: "text",
              style: S.input,
              value: form.webPath,
              onChange: (event) => update("webPath", event.target.value),
            }),
          ),
          h(
            "div",
            { style: S.actions },
            h(
              "button",
              { type: "button", style: S.primary, disabled: busy, onClick: save },
              "Save settings",
            ),
            h(
              "button",
              { type: "button", style: S.button, disabled: busy, onClick: importMemory },
              "Import memory",
            ),
            h(
              "div",
              { key: "rulesExport", style: S.rulesExport },
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
            ? h("div", { style: S.preview }, [
                h("h3", { key: "title", style: S.previewTitle }, "Rules export preview"),
                h(
                  "p",
                  { key: "meta", style: S.hint },
                  `Target: ${preview.target} \u00b7 Mode: ${preview.mode}` +
                    (preview.changed ? "" : " \u00b7 no changes"),
                ),
                preview.message ? h("p", { key: "message", style: S.hint }, preview.message) : null,
                h(
                  "p",
                  { key: "sources", style: S.hint },
                  (preview.sources || []).length === 0
                    ? "Sources: none"
                    : `Sources: ${(preview.sources || [])
                        .map((source) => `${source.path} (${source.bytes} bytes)`)
                        .join("; ")}`,
                ),
                preview.alreadyExported
                  ? h("p", { key: "already", style: S.hint }, ALREADY_EXPORTED_NOTE)
                  : null,
                h("pre", { key: "block", style: S.previewPre }, truncatePreview(preview.block)),
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
                    { type: "button", style: S.button, disabled: busy, onClick: cancelRulesPreview },
                    "Cancel",
                  ),
                ),
              ])
            : null,
          notice ? h("p", { style: S.notice }, notice) : null,
          report ? h("pre", { style: S.report }, report) : null,
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
        scope = ctx.settingsScope.bind({ namespace: NAMESPACE });
      } catch (error) {
        scope = null;
      }
      if (!scope) scope = unavailableScope();

      const MemoryView = createMemoryView(scope);
      const SidebarAction = createSidebarAction(scope);
      const SettingsCard = createSettingsCard(scope);

      ctx.slots.inject("conversation.view", () =>
        ctx.slots.register(
          { name: "conversation.view", id: VIEW_ID, order: ORDER, label: () => VIEW_LABEL },
          MemoryView,
        ),
      );

      // The WebUI panel is mounted directly in the DOM by the sidebar action.

      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          { name: "sidebar.footer.action", id: VIEW_ID, order: ORDER, label: () => VIEW_LABEL },
          SidebarAction,
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
