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
