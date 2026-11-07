// Літературний перекладач EN→UK: аналіз усього тексту → переклад → редактура.
// Supabase Edge Function. Секрет: ANTHROPIC_API_KEY. Пароль застосунку — lt_config.app_key (або секрет LT_APP_KEY).
// Кожен виклик action=run робить ОДИН крок пайплайна у фоні й сам запускає наступний,
// тож увесь переклад іде на сервері, навіть якщо вкладку закрито. pg_cron підхоплює обірвані кроки.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// пароль застосунку: секрет LT_APP_KEY або рядок app_key у таблиці lt_config
let APP_KEY = Deno.env.get("LT_APP_KEY") ?? "";
async function appKey() {
  if (!APP_KEY) {
    const { data } = await db.from("lt_config").select("value").eq("key", "app_key").single();
    APP_KEY = data?.value ?? "";
  }
  return APP_KEY;
}
const SELF_URL = `${SB_URL}/functions/v1/lit-translate`;
const STEP_LOCK_SECONDS = 60; // продовжується heartbeat-ом під час кроку

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-app-key, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

// USD за 1M токенів
const PRICES: Record<string, { in: number; out: number; cr: number; cw: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cr: 0.2, cw: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cr: 0.2, cw: 2.5 },
  "claude-fable-5-1": { in: 10, out: 50, cr: 1, cw: 12.5 },
};
const WEB_SEARCH_USD = 0.01;

// ───────────────────────── Текст: очищення й сегментація ─────────────────────────
function cleanSource(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/\t/g, " ");
  const s = t.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  if (s >= 0) t = t.slice(t.indexOf("\n", s) + 1);
  const e = t.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (e >= 0) t = t.slice(0, e);
  t = t.replace(/(\w)-\n(\w)/g, "$1$2"); // перенос слова
  const hasBlank = /\n[ ]*\n/.test(t);
  let paras: string[];
  if (hasBlank) paras = t.split(/\n[ ]*\n+/).map((p) => p.replace(/\s*\n\s*/g, " "));
  else paras = t.split("\n");
  paras = paras.map((p) => p.replace(/[ ]{2,}/g, " ").trim()).filter((p) => p && !/^\d{1,4}$/.test(p));
  return paras.join("\n\n");
}
const words = (s: string) => (s.match(/\S+/g) || []).length;

function segment(text: string, target = 350): { src: string[] }[] {
  const paras: string[] = [];
  for (const p of text.split(/\n\n+/)) {
    if (words(p) <= 600) { paras.push(p); continue; }
    // дуже довгий абзац ділимо по реченнях
    const sents = p.match(/[^.!?…]+[.!?…]+["'”’»)]*\s*|[^.!?…]+$/g) || [p];
    let cur = "";
    for (const s of sents) {
      if (cur && words(cur) + words(s) > 400) { paras.push(cur.trim()); cur = ""; }
      cur += s;
    }
    if (cur.trim()) paras.push(cur.trim());
  }
  const segs: { src: string[] }[] = [];
  let cur: string[] = [], n = 0;
  for (const p of paras) {
    const w = words(p);
    if (cur.length && n + w > target) { segs.push({ src: cur }); cur = []; n = 0; }
    cur.push(p); n += w;
  }
  if (cur.length) segs.push({ src: cur });
  return segs;
}

// ───────────────────────── Промпти ─────────────────────────
const TRANSLATOR_CORE = `Ти — майстер художнього перекладу з англійської на українську рівня найкращих українських перекладачів (Микола Лукаш, Ростислав Доценко, Олександр Терех, Віктор Морозов). Твій переклад має читатися як оригінальна українська проза, написана цим самим автором українською, — з тим самим голосом, ритмом, настроєм, іронією й образністю. Ти перекладаєш думку, образ, тон і ефект на читача, а не слова.

ОБОВ'ЯЗКОВІ НОРМИ УКРАЇНСЬКОЇ МОВИ (Український правопис 2019 року, сучасна літературна норма):
• Діалоги: кожна репліка з нового абзацу, починається з тире «— ». Слова автора після репліки: «— Ходімо, — сказав він.»; перед реплікою: «Він сказав: — Ходімо.» Англійські лапки в діалогах не зберігаються. Цитати й назви — лапки «ялинки», вкладені — „лапки“.
• Власні імена: передавай фонетично за правописом 2019 і усталеною традицією (h → г: Генрі, Гаррі; g → ґ лише якщо так затверджено в паспорті; th → т; w → в/у за традицією). Строго дотримуйся форм із перекладацького паспорта тексту — це затверджений глосарій.
• Тире — довге (—), дефіс лише в складних словах; три крапки — «…».
• Звертання в кличному відмінку, коли це природно (пане Джонсе, місіс Сміт — незмінні іменники не відмінюються).

АНТИКАЛЬКОВІ ПРАВИЛА (порушення = помилка):
• «бути», а не «являтися/являється»; «протягом», а не «на протязі»; «брати участь», а не «приймати участь»; «вживати заходів», а не «приймати міри»; «збігатися», а не «співпадати»; «наступний», а не «слідуючий»; «щодо», а не «на рахунок»; «правильно», а не «вірно» (якщо не про вірність); «брати до уваги», а не «приймати до уваги»; «у разі», а не «в випадку»; «завдяки» лише про позитивне.
• Не зловживай пасивом і безособовими формами на -но/-то, де українською природніший актив.
• Віддієслівні іменники («здійснення», «проведення») заміняй дієсловами.
• Не перекладай присвійні займенники механічно (he put his hand in his pocket → він сунув руку в кишеню).
• Порядок слів — український: нове (рема) ближче до кінця, без англійської жорсткої схеми підмет–присудок–додаток.
• Не нагромаджуй «який/яка/яке»: використовуй дієприслівникові звороти, окремі речення, сурядність.
• Ремарки said/asked/replied передавай природно й різноманітно, але без надмірних прикрас; там, де українською ремарка зайва, — опускай.
• Артиклі передавай лише коли вони несуть зміст («якийсь», «той самий»).
• Не русифікуй і не суржикуй. Мовні особливості персонажів (просторіччя, жаргон, діалект) передавай засобами української: розмовною лексикою, синтаксисом, фразеологією, а не штучним «суржиком» чи русизмами, — хіба що паспорт прямо вимагає інакше.
• Епохальні одиниці (фунт, миля, ярд, шилінг, долар, цент) не конвертуй.

ВІРНІСТЬ:
• Нічого не пропускай і не додавай від себе. Не пояснюй реалії у тексті вставками, якщо паспорт не каже інакше; сумнівні рішення фіксуються окремо, не в тексті.
• Зберігай абзацну структуру: стільки ж абзаців, у тому ж порядку.
• Метафори, порівняння, ідіоми, гру слів, алюзії перекладай за стратегіями з паспорта: збереження образу, якщо він зрозумілий і живий українською; заміна українським образом із тим самим ефектом; перефразування; компенсація в сусідньому місці. Не перетворюй живі образи на канцелярську прозу.
• Іронію, гумор, пафос, ритм речень і довжину періодів відтворюй так, як описано в паспорті ідіостилю.`;

const ANALYSIS_PARTS = [
  {
    key: "style",
    title: "Частина 1. Текст, автор, ідіостиль і настрій",
    task: `Склади ПЕРШУ частину «Перекладацького паспорта тексту» українською мовою. Розділи (markdown, заголовки ##):

## 1. Загальна характеристика
Автор, рік/епоха написання (якщо відомо), жанр і піджанр, обсяг, тип оповідача (1-ша/3-тя особа, всезнаючий/обмежений, ненадійний), фокалізація, час і місце дії, адресат (для кого писав автор).

## 2. Сюжет, теми, підтекст
Стислий зміст (5–8 речень), головні теми, ідея, підтекст, фінал і його ефект (наприклад, несподівана розв'язка), що читач має відчути.

## 3. Настрій і тональність
Домінантний настрій і як він змінюється по ходу тексту (по епізодах). Співвідношення гумору, іронії, сентиментальності, драматизму.

## 4. Ідіостиль автора (найважливіше — з цитатами-доказами з оригіналу)
- Синтаксис: середня довжина речень, періоди, підрядність, вставні конструкції, паралелізми, ритм, інверсії.
- Лексика: регістр (книжний/розмовний), латинізми, архаїзми, жаргон, «високий стиль» в іронічній функції, неологізми, перифрази.
- Як автор передає думки й почуття: прямий коментар оповідача, невласне пряма мова, деталь-символ, недомовленість, звертання до читача.
- Механізми гумору та іронії (зіткнення регістрів, гіпербола, літота, бурлеск, ерудовані алюзії тощо).
- Образність загалом: які типи метафор і порівнянь переважають, звідки беруться образи.
- Діалоги: як побудовані, чим відрізняються від авторської мови.

## 5. Відтворення ідіостилю українською
Для кожної ключової риси з розділу 4 — як саме відтворити її українською (конкретні мовні засоби, приклади можливих рішень). Українські стилістичні орієнтири (з яким регістром української прози співвідноситься текст).

Пиши конкретно, без води; кожне твердження про стиль підкріплюй короткою цитатою з оригіналу. Обсяг: 900–1400 слів.`,
  },
  {
    key: "realia",
    title: "Частина 2. Персонажі, імена, реалії та історичний контекст",
    task: `Склади ДРУГУ частину «Перекладацького паспорта тексту» українською мовою. Перша частина паспорта наведена нижче — не повторюй її. Розділи (markdown, заголовки ##):

## 6. Персонажі та їхнє мовлення
Для кожного персонажа з репліками: хто він (соціальний статус, вік, походження), особливості мовлення (регістр, сленг, діалект, помилки, улюблені звороти, мовний портрет) і як це передати українською (конкретні засоби), форма звертання між персонажами (ти/ви).

## 7. Імена та власні назви (затверджуваний глосарій)
Таблиця: | Оригінал | Українською | Пояснення (правопис 2019 / усталена традиція / промовисте ім'я — як обіграти) |. Включи всіх персонажів, топоніми, назви закладів, газет, брендів, вулиць. Якщо існує усталений український варіант (наприклад, О. Генрі, Нью-Йорк, Бродвей) — використовуй його.

## 8. Реалії та історико-культурний контекст
Для кожної реалії (побут, гроші й ціни, одяг, їжа, транспорт, установи, професії, спорт, ігри, мода, політичні й історичні події, соціальні типи, мовні реалії епохи): | Оригінал | Що це насправді (факти: епоха, місце, значення, вартість) | Рекомендований переклад | Стратегія (транскрипція, калька, описовий переклад, генералізація, конкретизація, функціональний відповідник, опущення) |. Перевір факти${"{{WEB}}"}. Окремо поясни, що сучасний читач може не зрозуміти і як це компенсувати без приміток (а примітки — лише якщо без них зміст втрачається).

## 9. Термінологія
Спеціальна лексика (морська, спортивна, юридична, медична, картярська тощо) з точними українськими відповідниками.

Обсяг: 700–1400 слів. Будь точним у фактах; якщо не впевнений — так і напиши.`,
  },
  {
    key: "imagery",
    title: "Частина 3. Образність, ідіоми, алюзії та стратегія перекладу",
    task: `Склади ТРЕТЮ, завершальну частину «Перекладацького паспорта тексту» українською мовою. Попередні частини наведені нижче — не повторюй їх. Розділи (markdown, заголовки ##):

## 10. Метафори, порівняння, ідіоми, гра слів, алюзії
Таблиця для кожного значущого випадку (до 40 найважливіших; вибирай найскладніші для перекладу): | № | Оригінал (цитата) | Тип (метафора/порівняння/ідіома/гра слів/алюзія/фразеологізм/епітет) | Значення і функція в тексті | Стратегія (збереження образу / заміна українським образом / перефразування / компенсація) | Варіант перекладу |. Для алюзій (Біблія, Шекспір, античність, тогочасна культура) — вкажи джерело і чи є усталений український відповідник.

## 11. Стратегія перекладу цього тексту
10–15 конкретних обов'язкових правил саме для цього тексту (наприклад: «довгі іронічно-високопарні періоди оповідача зберігати, не дробити»; «просторіччя Джима передавати розмовною лексикою, але без суржику»; «сленгові слівця 1900-х — нейтрально-розмовними відповідниками, не сучасним сленгом»).

## 12. Пастки перекладу
Хибні друзі перекладача, двозначності, місця, де легко спотворити сенс, застарілі значення слів (що слово означало в епоху автора), граматичні пастки. Для кожної — правильне рішення.

Обсяг: 900–1500 слів.`,
  },
];

const ANALYST_SYSTEM = `Ти — літературознавець-германіст і провідний перекладознавець, який готує перекладацький передпроєктний аналіз художнього тексту (англійська → українська). Ти уважно читаєш УВЕСЬ текст від початку до кінця, перш ніж робити висновки. Твій аналіз буде єдиною опорою для перекладача, тому він має бути точним, конкретним, з цитатами з оригіналу, без загальних фраз. Відповідай лише українською (цитати з оригіналу — англійською).`;

function sourceBlock(p: any) {
  const meta = [p.title && `Назва: ${p.title}`, p.author && `Автор: ${p.author}`, p.notes_for_ai && `Примітки замовника: ${p.notes_for_ai}`]
    .filter(Boolean).join("\n");
  return `${meta}\n\n<original_text>\n${p.source}\n</original_text>`;
}

// ───────────────────────── Anthropic (streaming) ─────────────────────────
type Usage = { input: number; output: number; cache_read: number; cache_write: number; searches: number };

async function callClaude(opts: {
  model: string; effort: string; system: any[]; user: string; maxTokens: number; webSearch?: boolean;
  onText?: (full: string) => void;
}): Promise<{ text: string; usage: Usage; stop: string }> {
  const body: any = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    stream: true,
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  };
  if (opts.webSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }];

  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) break;
    const errText = await res.text();
    if ([429, 500, 502, 503, 529].includes(res.status) && attempt < 3) {
      await new Promise((r) => setTimeout(r, [4000, 12000, 25000][attempt]));
      continue;
    }
    throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 500)}`);
  }
  const usage: Usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, searches: 0 };
  let text = "", stop = "", buf = "", lastEmit = 0;
  const reader = res!.body!.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev: any; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.type === "message_start") {
        const u = ev.message?.usage || {};
        usage.input = u.input_tokens || 0; usage.cache_read = u.cache_read_input_tokens || 0;
        usage.cache_write = u.cache_creation_input_tokens || 0;
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        text += ev.delta.text;
        if (opts.onText && Date.now() - lastEmit > 2500) { lastEmit = Date.now(); opts.onText(text); }
      } else if (ev.type === "content_block_start" && ev.content_block?.type === "server_tool_use") {
        usage.searches++;
      } else if (ev.type === "message_delta") {
        if (ev.usage?.output_tokens) usage.output = ev.usage.output_tokens;
        if (ev.usage?.input_tokens) usage.input = ev.usage.input_tokens;
        if (ev.usage?.cache_read_input_tokens != null) usage.cache_read = ev.usage.cache_read_input_tokens;
        if (ev.usage?.cache_creation_input_tokens != null) usage.cache_write = ev.usage.cache_creation_input_tokens;
        if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
      } else if (ev.type === "error") {
        throw new Error(`Anthropic stream error: ${JSON.stringify(ev.error).slice(0, 400)}`);
      }
    }
  }
  return { text, usage, stop };
}

function costOf(model: string, u: Usage) {
  const p = PRICES[model] || PRICES["claude-opus-5-5"];
  return (u.input * p.in + u.output * p.out + u.cache_read * p.cr + u.cache_write * p.cw) / 1e6 + u.searches * WEB_SEARCH_USD;
}

// ───────────────────────── Розбір відповідей ─────────────────────────
function between(s: string, tag: string): string | null {
  const a = s.indexOf(`<${tag}>`), b = s.lastIndexOf(`</${tag}>`);
  if (a < 0) return null;
  return s.slice(a + tag.length + 2, b > a ? b : undefined).trim();
}
function parseParas(block: string, n: number): string[] | null {
  const out: string[] = Array(n).fill("");
  const re = /\[\[(\d+)\]\]\s*([\s\S]*?)(?=\n?\s*\[\[\d+\]\]|$)/g;
  let m, found = 0;
  while ((m = re.exec(block))) {
    const k = +m[1] - 1;
    if (k >= 0 && k < n) { out[k] = (out[k] ? out[k] + "\n" : "") + m[2].trim(); found++; }
  }
  if (!found) return null;
  return out;
}
function parseNotes(s: string | null): any[] {
  if (!s) return [];
  const t = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : []; } catch { /* */ }
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* */ } }
  return [];
}
const numbered = (arr: string[]) => arr.map((p, i) => `[[${i + 1}]] ${p}`).join("\n\n");

// ───────────────────────── Кроки пайплайна ─────────────────────────
async function patch(id: string, fields: Record<string, unknown>) {
  const { error } = await db.from("lt_projects").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("DB: " + error.message);
}
async function addCost(p: any, model: string, u: Usage, label: string, ms: number) {
  const c = costOf(model, u);
  const t = p.tokens || {};
  const tokens = {
    input: (t.input || 0) + u.input, output: (t.output || 0) + u.output,
    cache_read: (t.cache_read || 0) + u.cache_read, cache_write: (t.cache_write || 0) + u.cache_write,
    searches: (t.searches || 0) + u.searches,
  };
  const log = [...(p.log || []), { at: new Date().toISOString(), step: label, model, usd: +c.toFixed(4), sec: Math.round(ms / 1000), ...u }].slice(-300);
  p.cost_usd = +(Number(p.cost_usd || 0) + c).toFixed(4); p.tokens = tokens; p.log = log;
  return { cost_usd: p.cost_usd, tokens, log };
}

function effortFor(p: any, base: string) {
  // після двох обірваних спроб того самого кроку — знижуємо effort, щоб вкластися в ліміт часу
  const a = p.cur?.attempts || 0;
  if (a >= 3) return "low";
  if (a >= 2) return base === "max" || base === "xhigh" || base === "high" ? "medium" : "low";
  return base;
}

async function stepAnalyze(p: any, k: number) {
  const part = ANALYSIS_PARTS[k];
  const prev = (p.analysis_parts || []).slice(0, k).join("\n\n");
  const task = part.task.replace("{{WEB}}", p.web_research ? " (за потреби скористайся вебпошуком, щоб звірити історичні факти, ціни, реалії епохи та усталені українські відповідники імен)" : "");
  const t0 = Date.now();
  const r = await callClaude({
    model: p.model, effort: effortFor(p, p.effort), maxTokens: 32000, webSearch: k === 1 && p.web_research,
    system: [
      { type: "text", text: ANALYST_SYSTEM },
      { type: "text", text: sourceBlock(p), cache_control: { type: "ephemeral" } },
    ],
    user: `${prev ? `<passport_so_far>\n${prev}\n</passport_so_far>\n\n` : ""}Прочитай увесь оригінальний текст повністю.\n\n${task}\n\nПочни відповідь одразу із заголовка «# ${part.title}».`,
    onText: (full) => { patch(p.id, { progress: full.slice(-5000) }).catch(() => {}); },
  });
  let text = r.text.trim();
  if (r.stop === "max_tokens") text += "\n\n_(частину обрізано через ліміт довжини)_";
  const parts = [...(p.analysis_parts || [])]; parts[k] = text;
  const fields: any = { analysis_parts: parts, progress: null, ...(await addCost(p, p.model, r.usage, `analysis:${part.key}`, Date.now() - t0)) };
  if (k === ANALYSIS_PARTS.length - 1) {
    fields.analysis = parts.join("\n\n---\n\n");
    if (p.pause_after_analysis && !p.approved) fields.status = "waiting_approval";
  }
  await patch(p.id, fields);
}

function translationSystem(p: any) {
  return [
    { type: "text", text: TRANSLATOR_CORE },
    {
      type: "text",
      text: `${sourceBlock(p)}\n\n<translation_passport>\nНижче — затверджений перекладацький паспорт цього тексту: аналіз стилю автора, настрою, персонажів, реалій, образності та стратегії. Він обов'язковий до виконання; імена й терміни — строго за ним.\n\n${p.analysis}\n</translation_passport>`,
      cache_control: { type: "ephemeral" },
    },
  ];
}
function prevContext(p: any, i: number) {
  const prev = (p.segments as any[]).slice(Math.max(0, i - 2), i)
    .map((s) => (s.user || s.final || s.draft || []).join("\n\n")).join("\n\n");
  return prev ? `<previous_translation>\n(Останні вже перекладені фрагменти — для зв'язності, тону й узгодженості імен. Не перекладай їх повторно.)\n${prev}\n</previous_translation>\n\n` : "";
}

async function stepTranslate(p: any, i: number) {
  const seg = p.segments[i];
  const n = seg.src.length;
  const t0 = Date.now();
  const r = await callClaude({
    model: p.model, effort: effortFor(p, p.effort), maxTokens: 24000, system: translationSystem(p),
    user: `${prevContext(p, i)}Ти бачиш увесь оригінал вище. Переклади фрагмент ${i + 1} з ${p.segments.length} (${n} абз.), враховуючи все, що відбувається до і після нього, ідіостиль автора, настрій епізоду та всі правила паспорта.

<fragment>
${numbered(seg.src)}
</fragment>

Спершу подумки визнач настрій епізоду, ключові образи й ризиковані місця. Потім дай ЛИШЕ результат у форматі:
<draft>
[[1]] переклад першого абзацу
[[2]] переклад другого абзацу
…
</draft>
Рівно ${n} абзаців із номерами [[1]]…[[${n}]], відповідно до оригіналу. Діалогові репліки всередині одного абзацу оригіналу можна розбити на рядки, але номер абзацу один.`,
    onText: (full) => { patch(p.id, { progress: full.slice(-5000) }).catch(() => {}); },
  });
  const block = between(r.text, "draft") ?? r.text;
  const paras = parseParas(block, n);
  if (!paras) throw new Error("Не вдалося розібрати переклад фрагмента " + (i + 1));
  const segs = [...p.segments]; segs[i] = { ...seg, draft: paras, final: null, notes: [] };
  p.segments = segs;
  await patch(p.id, { segments: segs, progress: null, ...(await addCost(p, p.model, r.usage, `translate:${i + 1}`, Date.now() - t0)) });
}

async function stepReview(p: any, i: number) {
  const seg = p.segments[i];
  const n = seg.src.length;
  const t0 = Date.now();
  const r = await callClaude({
    model: p.model, effort: effortFor(p, p.effort), maxTokens: 32000, system: translationSystem(p),
    user: `${prevContext(p, i)}Тепер ти — головний літературний редактор видавництва і водночас прискіпливий перевіряльник точності. Перед тобою фрагмент ${i + 1} з ${p.segments.length}: оригінал і чернетка перекладу.

<source>
${numbered(seg.src)}
</source>

<draft>
${numbered(seg.draft)}
</draft>

Перевір і виправ чернетку, звіряючись із паспортом і всім оригіналом:
1. Точність: пропуски, додавання, зміщення сенсу, неправильно зрозумілі ідіоми, хибні друзі перекладача, застарілі значення слів.
2. Ідіостиль: чи звучить це як цей автор (ритм, довжина періодів, регістр, іронія, механізми гумору) — за паспортом.
3. Настрій і ефект на читача — такий самий, як в оригіналі.
4. Природність української: антикалькові правила, порядок слів, милозвучність (чергування у/в, і/й), відсутність русизмів і канцеляризмів, жива мова діалогів, правопис 2019, пунктуація діалогів.
5. Узгодженість імен, реалій і термінів з паспортом і попередніми фрагментами.
6. Образність: кожна метафора, порівняння, ідіома, гра слів, алюзія — чи вдало передано; за потреби запропонуй сильніше рішення.
Виправляй лише те, що справді поліпшує текст; добре — не чіпай.

Дай відповідь РІВНО у форматі:
<final>
[[1]] остаточний текст першого абзацу
…
[[${n}]] …
</final>
<notes>
[JSON-масив рішень, які варто знати перекладачеві: кожна метафора/ідіома/гра слів/алюзія/реалія/ім'я цього фрагмента, а також кожне сумнівне місце. Формат елемента:
{"p": номер абзацу, "type": "metaphor|simile|idiom|wordplay|allusion|realia|name|term|accuracy|style|doubt", "src": "фрагмент оригіналу", "uk": "як перекладено", "strategy": "збереження образу|заміна образу|перефразування|компенсація|транскрипція|калька|описовий переклад|генералізація|конкретизація|функціональний відповідник|опущення|—", "comment": "коротке обґрунтування (1–2 речення)", "doubt": true якщо рішення сумнівне і людині варто перевірити, інакше false}]
</notes>`,
    onText: (full) => { patch(p.id, { progress: full.slice(-5000) }).catch(() => {}); },
  });
  const block = between(r.text, "final");
  const paras = block ? parseParas(block, n) : null;
  if (!paras) throw new Error("Не вдалося розібрати редактуру фрагмента " + (i + 1));
  for (let k = 0; k < n; k++) if (!paras[k]) paras[k] = seg.draft[k]; // страховка
  const notes = parseNotes(between(r.text, "notes"));
  const segs = [...p.segments]; segs[i] = { ...seg, final: paras, notes };
  p.segments = segs;
  await patch(p.id, { segments: segs, progress: null, ...(await addCost(p, p.model, r.usage, `review:${i + 1}`, Date.now() - t0)) });
}

function nextStep(p: any): { kind: string; i: number } | null {
  const parts = p.analysis_parts || [];
  for (let k = 0; k < ANALYSIS_PARTS.length; k++) if (!parts[k]) return { kind: "analyze", i: k };
  if (!p.analysis) return { kind: "join", i: 0 };
  if (p.pause_after_analysis && !p.approved) return null;
  for (let i = 0; i < p.segments.length; i++) {
    if (!p.segments[i].draft) return { kind: "translate", i };
    if (!p.segments[i].final) return { kind: "review", i };
  }
  return { kind: "done", i: 0 };
}
const stepLabel = (s: { kind: string; i: number }, p: any) =>
  s.kind === "analyze" ? `Аналіз тексту: ${ANALYSIS_PARTS[s.i].title}` :
  s.kind === "translate" ? `Переклад фрагмента ${s.i + 1}/${p.segments.length}` :
  s.kind === "review" ? `Редактура фрагмента ${s.i + 1}/${p.segments.length}` : s.kind;

async function kickNext(id: string) {
  try {
    await fetch(SELF_URL, { method: "POST", headers: { "content-type": "application/json", "x-app-key": await appKey() }, body: JSON.stringify({ action: "run", id }) });
  } catch (e) { console.error("chain failed", e); }
}

async function worker(id: string) {
  const { data: p } = await db.from("lt_projects").select("*").eq("id", id).single();
  if (!p || p.status !== "running") { await patch(id, { busy_until: null }); return; }
  const s = nextStep(p);
  if (!s) { await patch(id, { status: "waiting_approval", busy_until: null, step: null }); return; }
  if (s.kind === "join") { await patch(id, { analysis: p.analysis_parts.join("\n\n---\n\n"), busy_until: null }); return kickNext(id); }
  if (s.kind === "done") { await patch(id, { status: "done", step: null, progress: null, busy_until: null, cur: {} }); return; }

  const key = `${s.kind}:${s.i}`;
  const attempts = p.cur?.key === key ? (p.cur.attempts || 0) + 1 : 1;
  if (attempts > 4) {
    await patch(id, { status: "error", error: `Крок «${stepLabel(s, p)}» обривався 4 рази поспіль (ліміт часу або мережа). Спробуй модель Sonnet або нижчий effort і натисни «Продовжити».`, busy_until: null });
    return;
  }
  p.cur = { key, attempts };
  await patch(id, { step: stepLabel(s, p), cur: p.cur, error: null, progress: null });
  // heartbeat: поки крок живий, тримаємо замок; якщо функцію вбито — замок спаде за ≤60 с і watchdog продовжить
  let hbOn = true, hbPending: PromiseLike<unknown> = Promise.resolve();
  const hb = setInterval(() => {
    if (!hbOn) return;
    hbPending = db.from("lt_projects").update({ busy_until: new Date(Date.now() + 60000).toISOString() }).eq("id", id).then(() => {});
  }, 15000);
  const stopHb = async () => { hbOn = false; clearInterval(hb); await hbPending; };
  try {
    if (s.kind === "analyze") await stepAnalyze(p, s.i);
    else if (s.kind === "translate") await stepTranslate(p, s.i);
    else await stepReview(p, s.i);
    await stopHb();
    await patch(id, { busy_until: null, cur: {} });
  } catch (e) {
    await stopHb();
    console.error(e);
    const msg = String((e as Error)?.message || e);
    const fatal = /Anthropic 4(00|01|03|04)/.test(msg) || /credit|billing|invalid x-api-key/i.test(msg);
    await patch(id, { busy_until: null, ...(fatal || attempts >= 3 ? { status: "error", error: msg } : { error: msg }) });
    if (fatal || attempts >= 3) return;
  }
  const { data: after } = await db.from("lt_projects").select("status").eq("id", id).single();
  if (after?.status === "running") await kickNext(id);
}

// ───────────────────────── HTTP API ─────────────────────────
const LIST_COLS = "id,title,author,status,step,error,cost_usd,model,created_at,updated_at,segments";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = await appKey();
  if (!key || req.headers.get("x-app-key") !== key) return json({ error: "Невірний пароль" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  try {
    switch (b.action) {
      case "ping": return json({ ok: true, hasKey: !!ANTHROPIC_KEY, models: Object.keys(PRICES) });

      case "list": {
        const { data, error } = await db.from("lt_projects").select(LIST_COLS).order("updated_at", { ascending: false }).limit(100);
        if (error) throw error;
        return json(data.map((r: any) => ({
          ...r, segments: undefined, nseg: r.segments.length,
          ndone: r.segments.filter((s: any) => s.final).length,
          words: r.segments.reduce((a: number, s: any) => a + words(s.src.join(" ")), 0),
        })));
      }

      case "get": {
        const { data, error } = await db.from("lt_projects").select("*").eq("id", b.id).single();
        if (error) throw error;
        return json(data);
      }

      case "create": {
        const src = cleanSource(String(b.source || ""));
        const w = words(src);
        if (w < 20) return json({ error: "Текст закороткий" }, 400);
        if (w > 60000) return json({ error: `Текст завеликий (${w} слів). Максимум — 60 000 слів за раз.` }, 400);
        const model = PRICES[b.model] ? b.model : "claude-opus-5-5";
        const effort = ["low", "medium", "high", "xhigh", "max"].includes(b.effort) ? b.effort : "high";
        const row = {
          title: (b.title || "").trim() || src.slice(0, 40) + "…", author: b.author || null, notes_for_ai: b.notes_for_ai || null,
          source: src, model, effort, pause_after_analysis: b.pause_after_analysis !== false, web_research: b.web_research !== false,
          segments: segment(src), status: b.start === false ? "new" : "running",
        };
        const { data, error } = await db.from("lt_projects").insert(row).select("id").single();
        if (error) throw error;
        if (row.status === "running") await startRun(data.id);
        return json({ id: data.id });
      }

      case "update": {
        const allowed = ["title", "author", "notes_for_ai", "analysis", "approved", "model", "effort", "pause_after_analysis", "web_research"];
        const f: any = {};
        for (const k of allowed) if (k in (b.patch || {})) f[k] = b.patch[k];
        if (b.segment != null) {
          const { data: p } = await db.from("lt_projects").select("segments").eq("id", b.id).single();
          const segs = p!.segments; segs[b.segment] = { ...segs[b.segment], user: b.user ?? null };
          f.segments = segs;
        }
        await patch(b.id, f);
        return json({ ok: true });
      }

      case "run": {
        const { data: p } = await db.from("lt_projects").select("status").eq("id", b.id).single();
        if (!p) return json({ error: "not found" }, 404);
        if (b.resume || p.status !== "running") {
          if (p.status === "done" && !b.resume) return json({ ok: true, status: "done" });
          await patch(b.id, { status: "running", error: null });
        }
        return json({ started: await startRun(b.id) });
      }

      case "approve": {
        await patch(b.id, { approved: true, status: "running", ...(b.analysis != null ? { analysis: b.analysis } : {}) });
        return json({ started: await startRun(b.id) });
      }

      case "stop": {
        await patch(b.id, { status: "paused" });
        return json({ ok: true });
      }

      case "redo": {
        const { data: p } = await db.from("lt_projects").select("*").eq("id", b.id).single();
        if (!p) return json({ error: "not found" }, 404);
        const f: any = { status: "running", error: null, cur: {} };
        if (b.what === "analysis") { f.analysis_parts = []; f.analysis = null; f.approved = false; f.segments = p.segments.map((s: any) => ({ src: s.src })); }
        else if (b.what === "translation") { f.segments = p.segments.map((s: any) => ({ src: s.src })); }
        else if (b.what === "segment") { const segs = [...p.segments]; segs[b.index] = { src: segs[b.index].src }; f.segments = segs; }
        else if (b.what === "review") { const segs = [...p.segments]; segs[b.index] = { ...segs[b.index], final: null, notes: [] }; f.segments = segs; }
        await patch(b.id, f);
        return json({ started: await startRun(b.id) });
      }

      case "delete": {
        await db.from("lt_projects").delete().eq("id", b.id);
        return json({ ok: true });
      }

      case "watchdog": {
        // викликається pg_cron щохвилини: підхоплює обірвані кроки
        const { data } = await db.from("lt_projects").select("id,busy_until").eq("status", "running");
        let n = 0;
        for (const r of data || []) {
          if (!r.busy_until || new Date(r.busy_until).getTime() < Date.now()) { if (await startRun(r.id)) n++; }
        }
        return json({ restarted: n });
      }

      default: return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

async function startRun(id: string): Promise<boolean> {
  const { data: ok } = await db.rpc("lt_claim", { p_id: id, p_seconds: STEP_LOCK_SECONDS });
  if (!ok) return false;
  // @ts-ignore EdgeRuntime існує в Supabase
  EdgeRuntime.waitUntil(worker(id).catch(async (e) => {
    console.error("worker", e);
    await patch(id, { busy_until: null, error: String(e?.message || e) }).catch(() => {});
  }));
  return true;
}
