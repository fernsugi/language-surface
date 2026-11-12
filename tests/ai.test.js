const test = require("node:test");
const assert = require("node:assert/strict");
const LS = require("./_load.js");

const { ai } = LS;

function settings(provider, extra) {
  const s = LS.migrate.defaultSettings().ai;
  s.provider = provider || "openai";
  s.providers.openai.apiKey = "sk-test";
  s.providers.zai.apiKey = "zk-test";
  return Object.assign(s, extra || {});
}

/** Install a fake fetch that answers from a queue of handlers; returns the recorded calls. */
function mockFetch(handlers) {
  const calls = [];
  const queue = handlers.slice();
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const res = typeof next === "function" ? next(url, init, body) : next;
    if (res instanceof Error) throw res;
    return res;
  };
  return calls;
}

function json(status, data, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: (k) => (headers && headers[k.toLowerCase()]) || null },
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

const responsesOk = (text) => json(200, { output: [{ type: "message", content: [{ type: "output_text", text }] }] });
const chatOk = (text) => json(200, { choices: [{ message: { content: text } }] });

test("buildPrompt includes languages, limits, glossary and context", () => {
  const prompt = ai.buildPrompt({ sourceLang: "ja", targetLang: "zhs", maxChars: 12, rules: [{ from: "Lv.*", to: "Lv.*" }], context: "Fantasy RPG" });
  assert.match(prompt, /from Japanese \(JA\) to ZHS/);
  assert.match(prompt, /at most 12 characters/);
  assert.match(prompt, /"Lv\.\*" → "Lv\.\*"/);
  assert.match(prompt, /any single character/);
  assert.match(prompt, /Context and style: Fantasy RPG/);
  assert.match(prompt, /Transliterate all names/);
  assert.match(prompt, /Keep placeholders/);
  const bare = ai.buildPrompt({ sourceLang: "en", targetLang: "fr" });
  assert.doesNotMatch(bare, /Glossary|at most|Context and style/);
});

test("cleanOutput strips wrapping quotes and reasoning blocks", () => {
  assert.equal(ai.cleanOutput('  "Bonjour"  ', "Hello"), "Bonjour");
  assert.equal(ai.cleanOutput("「こんにちは」", "Hello"), "こんにちは");
  assert.equal(ai.cleanOutput('"Bonjour"', '"Hello"'), '"Bonjour"');
  assert.equal(ai.cleanOutput('"A" and "B"', "x"), '"A" and "B"');
  assert.equal(ai.cleanOutput("<think>hmm</think>\nBonjour", "Hello"), "Bonjour");
});

test("configProblem explains what is missing", () => {
  const s = LS.migrate.defaultSettings().ai;
  assert.match(ai.configProblem(s), /OpenAI API key/);
  s.provider = "custom";
  assert.match(ai.configProblem(s), /base URL/);
  s.providers.custom.baseUrl = "http://localhost:11434/v1/";
  assert.match(ai.configProblem(s), /model/);
  s.providers.custom.model = "llama3";
  assert.equal(ai.configProblem(s), "");
  assert.equal(ai.resolveConfig(s).baseUrl, "http://localhost:11434/v1");
});

test("translate: OpenAI Responses request shape and glossary filtering", async () => {
  const calls = mockFetch([responsesOk(" Épée rouillée ")]);
  const out = await ai.translate({
    ai: settings("openai"),
    text: "  Rusty sword ",
    sourceLang: "en",
    targetLang: "fr",
    glossary: [
      { sourceLang: "en", targetLang: "fr", from: "sword", to: "épée" },
      { sourceLang: "en", targetLang: "fr", from: "shield", to: "bouclier" },
    ],
    context: "Game",
  });
  assert.deepEqual(out, { text: "Épée rouillée", overLimit: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  assert.equal(calls[0].body.model, "gpt-4o-mini");
  assert.equal(calls[0].body.input, "Rusty sword");
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].body.temperature, 0.2);
  assert.match(calls[0].body.instructions, /"sword" → "épée"/);
  assert.doesNotMatch(calls[0].body.instructions, /bouclier/);
});

test("translate: chat completions for Z.ai and custom endpoints", async () => {
  let calls = mockFetch([chatOk("你好")]);
  let out = await ai.translate({ ai: settings("zai"), text: "こんにちは", sourceLang: "ja", targetLang: "zh-hans" });
  assert.equal(out.text, "你好");
  assert.equal(calls[0].url, "https://api.z.ai/api/paas/v4/chat/completions");
  assert.equal(calls[0].body.model, "glm-4.5");
  assert.deepEqual(calls[0].body.messages.map((m) => m.role), ["system", "user"]);
  assert.equal(calls[0].body.messages[1].content, "こんにちは");

  const s = settings("custom");
  s.providers.custom = { apiKey: "", model: "llama3", baseUrl: "http://localhost:11434/v1" };
  calls = mockFetch([chatOk("Hallo")]);
  out = await ai.translate({ ai: s, text: "Hello", sourceLang: "en", targetLang: "de" });
  assert.equal(out.text, "Hallo");
  assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("translate: retries without temperature when the model rejects it", async () => {
  const s = settings("openai");
  s.providers.openai.model = "reasoning-model-x";
  const calls = mockFetch([json(400, { error: { message: "Unsupported parameter: 'temperature' is not supported with this model." } }), responsesOk("Bonjour")]);
  const out = await ai.translate({ ai: s, text: "Hello", sourceLang: "en", targetLang: "fr" });
  assert.equal(out.text, "Bonjour");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.temperature, undefined);
  // Remembered for the rest of the session.
  const again = mockFetch([responsesOk("Salut")]);
  await ai.translate({ ai: s, text: "Hi", sourceLang: "en", targetLang: "fr" });
  assert.equal(again.length, 1);
  assert.equal(again[0].body.temperature, undefined);
});

test("translate: one corrective attempt when the result is too long", async () => {
  const calls = mockFetch([responsesOk("Une très longue traduction"), responsesOk("Court")]);
  const out = await ai.translate({ ai: settings("openai"), text: "Short", sourceLang: "en", targetLang: "fr", maxChars: 6 });
  assert.deepEqual(out, { text: "Court", overLimit: false });
  assert.equal(calls.length, 2);
  assert.match(calls[1].body.instructions, /too long/);

  mockFetch([responsesOk("Toujours trop longue"), responsesOk("Encore bien trop longue")]);
  const still = await ai.translate({ ai: settings("openai"), text: "Short", sourceLang: "en", targetLang: "fr", maxChars: 6 });
  assert.deepEqual(still, { text: "Toujours trop longue", overLimit: true });
});

test("translate: error classification", async () => {
  const run = () => ai.translate({ ai: settings("openai"), text: "Hello", sourceLang: "en", targetLang: "fr" });

  mockFetch([json(401, { error: { message: "Incorrect API key provided" } })]);
  await assert.rejects(run, (e) => e.kind === "auth" && e.fatal && /Incorrect API key/.test(e.message));

  mockFetch([json(429, { error: { message: "Rate limit reached. Please try again in 7s." } })]);
  await assert.rejects(run, (e) => e.kind === "rate" && e.retryable && e.retryAfter === 7);

  mockFetch([json(429, { error: { message: "Slow down" } }, { "retry-after": "3" })]);
  await assert.rejects(run, (e) => e.kind === "rate" && e.retryAfter === 3);

  mockFetch([json(503, { error: { message: "Overloaded" } })]);
  await assert.rejects(run, (e) => e.kind === "server" && e.retryable);

  mockFetch([json(404, { error: { message: "The model does not exist" } })]);
  await assert.rejects(run, (e) => e.kind === "request" && !e.retryable);

  mockFetch([new TypeError("Failed to fetch")]);
  await assert.rejects(run, (e) => e.kind === "network" && e.retryable);

  mockFetch([responsesOk("   ")]);
  await assert.rejects(run, (e) => e.kind === "empty");

  mockFetch([json(200, { output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help with that" }] }] })]);
  await assert.rejects(run, (e) => e.kind === "refused");

  await assert.rejects(() => ai.translate({ ai: LS.migrate.defaultSettings().ai, text: "Hello", sourceLang: "en", targetLang: "fr" }), (e) => e.kind === "config");
  await assert.rejects(() => ai.translate({ ai: settings("openai"), text: "  ", sourceLang: "en", targetLang: "fr" }), (e) => e.kind === "request");
});

test("withRetry retries transient failures, honours the shared gate, and gives up on fatal ones", async () => {
  let n = 0;
  const waits = [];
  const gate = { until: 0 };
  const result = await ai.withRetry(
    async () => {
      n++;
      if (n < 3) throw new ai.AIError("rate", "slow down", { retryAfter: 0.001 });
      return "ok";
    },
    { gate, onWait: (w) => waits.push(w.attempt) }
  );
  assert.equal(result, "ok");
  assert.equal(n, 3);
  assert.deepEqual(waits, [1, 2]);
  assert.ok(gate.until > 0);

  let calls = 0;
  await assert.rejects(
    () =>
      ai.withRetry(async () => {
        calls++;
        throw new ai.AIError("auth", "bad key");
      }),
    (e) => e.kind === "auth"
  );
  assert.equal(calls, 1);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => ai.withRetry(async () => "never", { signal: controller.signal }), (e) => e.kind === "aborted");
});

test("runQueue limits concurrency and stops when aborted", async () => {
  let active = 0;
  let peak = 0;
  const done = [];
  await ai.runQueue(
    [1, 2, 3, 4, 5, 6, 7],
    async (item) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      done.push(item);
    },
    { concurrency: 3 }
  );
  assert.equal(peak, 3);
  assert.equal(done.length, 7);

  const controller = new AbortController();
  const seen = [];
  await ai.runQueue(
    [1, 2, 3, 4],
    async (item) => {
      seen.push(item);
      if (item === 2) controller.abort();
    },
    { concurrency: 1, signal: controller.signal }
  );
  assert.deepEqual(seen, [1, 2]);
});

test("listModels filters non-text models", async () => {
  const calls = mockFetch([json(200, { data: [{ id: "gpt-4o-mini" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }, { id: "gpt-4o" }, { id: "gpt-4o" }] })]);
  const models = await ai.listModels(settings("openai"));
  assert.deepEqual(models, ["gpt-4o", "gpt-4o-mini"]);
  assert.equal(calls[0].url, "https://api.openai.com/v1/models");
  assert.equal(calls[0].init.method, "GET");
});

/* ---- Anthropic (Claude) ------------------------------------------------------------------ */

function claudeSettings(model) {
  const s = settings("anthropic");
  s.providers.anthropic.apiKey = "sk-ant-test";
  if (model) s.providers.anthropic.model = model;
  return s;
}

const claudeOk = (text, extra) => json(200, Object.assign({ type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn" }, extra || {}));
const claudeError = (status, type, message, headers) => json(status, { type: "error", error: { type, message }, request_id: "req_test" }, headers);

test("Anthropic is offered as a provider with a current default model", () => {
  const def = ai.PROVIDERS.anthropic;
  assert.equal(def.label, "Anthropic");
  assert.equal(def.defaultModel, "claude-opus-5-5");
  assert.ok(def.models.includes(def.defaultModel));
  const fresh = LS.migrate.defaultSettings().ai;
  assert.deepEqual(fresh.providers.anthropic, { apiKey: "", model: "claude-opus-5-5" });
  fresh.provider = "anthropic";
  assert.match(ai.configProblem(fresh), /Anthropic API key/);
  // Settings saved before the provider existed gain it on load, and keep everything else.
  const older = LS.migrate.normalizeSettings({ ai: { provider: "zai", providers: { openai: { apiKey: "sk-old", model: "gpt-4o" }, zai: { apiKey: "zk-old", model: "glm-4.6" } } } });
  assert.equal(older.ai.provider, "zai");
  assert.equal(older.ai.providers.openai.apiKey, "sk-old");
  assert.equal(older.ai.providers.zai.model, "glm-4.6");
  assert.deepEqual(older.ai.providers.anthropic, { apiKey: "", model: "claude-opus-5-5" });
  const chosen = LS.migrate.normalizeSettings({ ai: { provider: "anthropic", providers: { anthropic: { apiKey: "sk-ant-x", model: "claude-haiku-5-5" } } } });
  assert.equal(chosen.ai.provider, "anthropic");
  assert.deepEqual(chosen.ai.providers.anthropic, { apiKey: "sk-ant-x", model: "claude-haiku-5-5" });
});

test("translate: Claude Messages request shape", async () => {
  const calls = mockFetch([claudeOk(" Épée rouillée ")]);
  const out = await ai.translate({
    ai: claudeSettings(),
    text: "  Rusty sword ",
    sourceLang: "en",
    targetLang: "fr",
    glossary: [{ sourceLang: "en", targetLang: "fr", from: "sword", to: "épée" }],
    context: "Game",
  });
  assert.deepEqual(out, { text: "Épée rouillée", overLimit: false });
  assert.equal(calls.length, 1);
  const { url, init, body } = calls[0];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["x-api-key"], "sk-ant-test");
  assert.equal(init.headers["anthropic-version"], "2026-10-21");
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true", "required for requests made from a web page");
  assert.equal(init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(init.headers.Authorization, undefined, "the key is not also sent as a bearer token");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.max_tokens, 16000);
  assert.deepEqual(body.messages, [{ role: "user", content: "Rusty sword" }]);
  assert.match(body.system, /professional localization translator/);
  assert.match(body.system, /"sword" → "épée"/);
  assert.match(body.system, /Context and style: Game/);
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.equal(body.fallbacks, "default");
  // This API version rejects sampling parameters on every model, and thinking is left to the model.
  for (const field of ["temperature", "top_p", "top_k", "thinking", "stream"]) assert.equal(field in body, false, field + " must not be sent");
});

test("translate: Claude answers are read from text blocks only", async () => {
  mockFetch([
    json(200, {
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } },
        { type: "text", text: "Bon" },
        { type: "text", text: "jour" },
      ],
      stop_reason: "end_turn",
    }),
  ]);
  const out = await ai.translate({ ai: claudeSettings(), text: "Hello", sourceLang: "en", targetLang: "fr" });
  assert.equal(out.text, "Bonjour");
});

test("translate: a Claude refusal or a cut-off answer is reported, not saved", async () => {
  const run = () => ai.translate({ ai: claudeSettings(), text: "Hello", sourceLang: "en", targetLang: "fr" });

  mockFetch([json(200, { content: [], stop_reason: "refusal", stop_details: { category: "cyber", explanation: "This request was declined." } })]);
  await assert.rejects(run, (e) => e.kind === "refused" && !e.retryable && !e.fatal && /declined to translate this text: This request was declined\./.test(e.message));

  // Text that arrived before a refusal is not a translation.
  mockFetch([json(200, { content: [{ type: "text", text: "Bonj" }], stop_reason: "refusal" })]);
  await assert.rejects(run, (e) => e.kind === "refused" && /declined to translate this text\.$/.test(e.message));

  mockFetch([json(200, { content: [{ type: "text", text: "Bonjour, ceci est" }], stop_reason: "max_tokens" })]);
  await assert.rejects(run, (e) => e.kind === "request" && /ran out of room/.test(e.message));

  mockFetch([claudeOk("   ")]);
  await assert.rejects(run, (e) => e.kind === "empty" && /Anthropic returned an empty translation/.test(e.message));
});

test("translate: options a Claude model does not accept are dropped and remembered", async () => {
  const s = claudeSettings("claude-test-no-options");
  const run = (text) => ai.translate({ ai: s, text, sourceLang: "en", targetLang: "fr" });
  let calls = mockFetch([
    claudeError(400, "invalid_request_error", "fallbacks: this model does not support server-side fallbacks"),
    claudeError(400, "invalid_request_error", "output_config.effort is not supported for this model"),
    claudeOk("Bonjour"),
  ]);
  assert.equal((await run("Hello")).text, "Bonjour");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.fallbacks, "default");
  assert.equal(calls[1].body.fallbacks, undefined);
  assert.equal(calls[1].init.headers["anthropic-beta"], undefined, "the beta header goes with the option");
  assert.deepEqual(calls[1].body.output_config, { effort: "low" });
  assert.equal(calls[2].body.output_config, undefined);
  assert.equal(calls[2].body.fallbacks, undefined);

  // Remembered for the rest of the session, for that model only.
  calls = mockFetch([claudeOk("Salut")]);
  await run("Hi");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.output_config, undefined);
  assert.equal(calls[0].body.fallbacks, undefined);
  calls = mockFetch([claudeOk("Salut")]);
  await ai.translate({ ai: claudeSettings("claude-test-other"), text: "Hi", sourceLang: "en", targetLang: "fr" });
  assert.deepEqual(calls[0].body.output_config, { effort: "low" });
  assert.equal(calls[0].body.fallbacks, "default");

  // A beta header the organisation cannot use is handled the same way.
  calls = mockFetch([claudeError(400, "invalid_request_error", "Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header."), claudeOk("Bonjour")]);
  assert.equal((await ai.translate({ ai: claudeSettings("claude-test-no-beta"), text: "Hello", sourceLang: "en", targetLang: "fr" })).text, "Bonjour");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers["anthropic-beta"], undefined);
  assert.deepEqual(calls[1].body.output_config, { effort: "low" });

  // Any other 400 is a real error and is not retried.
  calls = mockFetch([claudeError(400, "invalid_request_error", "messages: at least one message is required")]);
  await assert.rejects(() => ai.translate({ ai: claudeSettings("claude-test-bad"), text: "Hello", sourceLang: "en", targetLang: "fr" }), (e) => e.kind === "request" && e.status === 400);
  assert.equal(calls.length, 1);
});

test("translate: Claude API errors are classified", async () => {
  const run = () => ai.translate({ ai: claudeSettings(), text: "Hello", sourceLang: "en", targetLang: "fr" });

  mockFetch([claudeError(401, "authentication_error", "invalid x-api-key")]);
  await assert.rejects(run, (e) => e.kind === "auth" && e.fatal && e.message === "Anthropic error 401: invalid x-api-key");

  mockFetch([claudeError(403, "permission_error", "Not allowed")]);
  await assert.rejects(run, (e) => e.kind === "auth" && e.fatal);

  mockFetch([claudeError(404, "not_found_error", "model: claude-nope")]);
  await assert.rejects(run, (e) => e.kind === "request" && !e.retryable && /model: claude-nope/.test(e.message));

  mockFetch([claudeError(429, "rate_limit_error", "Too many requests", { "retry-after": "4" })]);
  await assert.rejects(run, (e) => e.kind === "rate" && e.retryable && e.retryAfter === 4);

  mockFetch([claudeError(529, "overloaded_error", "Overloaded")]);
  await assert.rejects(run, (e) => e.kind === "server" && e.retryable && e.status === 529);

  mockFetch([claudeError(500, "api_error", "Internal error")]);
  await assert.rejects(run, (e) => e.kind === "server" && e.retryable);
});

test("running out of credit stops a run instead of being retried like a rate limit", async () => {
  const claude = () => ai.translate({ ai: claudeSettings(), text: "Hello", sourceLang: "en", targetLang: "fr" });
  mockFetch([claudeError(402, "billing_error", "Your credit balance is too low")]);
  await assert.rejects(claude, (e) => e.kind === "billing" && e.fatal && !e.retryable);

  mockFetch([json(429, { type: "error", error: { type: "rate_limit_error", message: "Monthly spend limit reached", details: { error_code: "enforced_spend_limit_reached" } } })]);
  await assert.rejects(claude, (e) => e.kind === "billing" && e.fatal && !e.retryable);

  mockFetch([json(429, { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } })]);
  await assert.rejects(() => ai.translate({ ai: settings("openai"), text: "Hello", sourceLang: "en", targetLang: "fr" }), (e) => e.kind === "billing" && e.fatal);

  // An ordinary rate limit is still retried.
  let n = 0;
  mockFetch([() => (++n < 2 ? claudeError(429, "rate_limit_error", "Slow down", { "retry-after": "0" }) : claudeOk("Bonjour"))]);
  const out = await ai.withRetry(claude, { retries: 2 });
  assert.equal(out.text, "Bonjour");
  assert.equal(n, 2);
});

test("listModels asks Anthropic for the whole list", async () => {
  const calls = mockFetch([
    json(200, {
      data: [
        { type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
        { type: "model", id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" },
        { type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
      ],
      has_more: false,
      first_id: "claude-opus-5-5",
      last_id: "claude-opus-5-5",
    }),
  ]);
  const models = await ai.listModels(claudeSettings());
  assert.deepEqual(models, ["claude-haiku-5-5", "claude-opus-5-5"]);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/models?limit=1000");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers["x-api-key"], "sk-ant-test");
  assert.equal(calls[0].init.headers["anthropic-version"], "2026-10-21");
  assert.equal(calls[0].init.headers["anthropic-dangerous-direct-browser-access"], "true");

  const none = LS.migrate.defaultSettings().ai;
  none.provider = "anthropic";
  await assert.rejects(() => ai.listModels(none), (e) => e.kind === "config" && /Anthropic API key/.test(e.message));
});
